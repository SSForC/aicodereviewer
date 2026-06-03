"""
Agent modülü — LangGraph graph tanımı.

Agent pipeline:
  context_builder → planner → action ⟷ observer → summary_updater

Edge mantığı:
  observer → action  (devam et / hata düzelt)
  observer → summary_updater → END  (bitti)
  current_step >= max_steps → END  (timeout)

Kullanım:
    from agent.graph import run_agent

    result = await run_agent(
        project_id="abc123",
        user_request="Login sayfası ekle",
        session_id="sess_xyz",
    )
"""

from datetime import datetime, timezone
from typing import TypedDict

from langgraph.graph import StateGraph, END
from motor.motor_asyncio import AsyncIOMotorDatabase
import structlog

from agent.nodes import (
    action_node,
    context_builder_node,
    observer_node,
    planner_node,
    summary_updater_node,
    _is_simple_text_edit_request,
)
from core.config import settings
from core.database import Database

logger = structlog.get_logger(__name__)


def _extract_tool_payload(raw: str) -> dict | None:
    """Action JSON içeriğinden tool payload çıkar."""
    import json
    import re

    clean = (raw or "").strip()
    if not clean:
        return None

    match = re.search(r"```(?:json)?\s*({.*?})\s*```", clean, re.DOTALL)
    if match:
        clean = match.group(1).strip()
    elif "{" in clean and "}" in clean:
        start = clean.index("{")
        end = clean.rindex("}") + 1
        clean = clean[start:end]

    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        return None


def _collect_action_events(messages: list[dict]) -> list[dict]:
    """messages listesinden action/tool event çiftlerini çıkar."""
    events: list[dict] = []

    for msg in messages:
        if msg.get("node") != "action":
            continue

        role = msg.get("role")
        if role == "assistant":
            payload = _extract_tool_payload(str(msg.get("content", "")))
            if not payload:
                continue
            events.append({
                "tool": str(payload.get("tool", "")).strip().lower(),
                "args": payload.get("args", {}) or {},
                "result": "",
            })
        elif role == "tool":
            if events and not events[-1]["result"]:
                events[-1]["result"] = str(msg.get("content", ""))

    return events


def _is_write_then_verify_completed(state: dict) -> bool:
    """
    write_file sonrası list_files/read_file ile doğrulama yapıldıysa tamamlandı kabul et.
    """
    events = _collect_action_events(state.get("messages", []))
    if len(events) < 2:
        return False

    verify = events[-1]
    write = events[-2]

    if write.get("tool") != "write_file":
        return False
    if verify.get("tool") not in ("list_files", "read_file"):
        return False

    write_result = (write.get("result") or "").lower()
    if "dosya yaz" not in write_result:
        return False

    path = str(write.get("args", {}).get("path", "")).strip()
    if not path:
        return False
    filename = path.replace("\\", "/").split("/")[-1].lower()

    verify_result = (verify.get("result") or "").lower()
    if not verify_result:
        return False

    return filename in verify_result


def _is_stalled_same_tool_loop(state: dict) -> bool:
    """
    Son 3 action aynı tool ve sonuçlarda yeni ilerleme yoksa loop kabul et.
    """
    events = _collect_action_events(state.get("messages", []))
    if len(events) < 3:
        return False

    tail = events[-3:]
    tools = {e.get("tool") for e in tail}
    if len(tools) != 1:
        return False

    results = [(e.get("result") or "").strip().lower() for e in tail]
    if any(("tool hatası" in r) or ("tool parse hatası" in r) for r in results):
        return False

    return len(set(results)) <= 1


def _has_successful_write(state: dict) -> bool:
    """Son action geçmişinde başarılı bir write_file var mı?"""
    events = _collect_action_events(state.get("messages", []))
    for event in reversed(events):
        if event.get("tool") != "write_file":
            continue
        result = (event.get("result") or "").lower()
        return "dosya yazıldı" in result and "tool hatası" not in result
    return False


# ═══════════════════════════════════════════════════════
# AGENT STATE
# ═══════════════════════════════════════════════════════


class AgentState(TypedDict, total=False):
    """
    Agent'ın graph boyunca taşıdığı durum.

    Her node bu state'i okur ve günceller.
    """

    # Temel bilgiler
    project_id: str
    user_request: str
    session_id: str

    # Bağlam (context_builder tarafından dolduruluEr)
    file_tree: str
    file_summaries: str
    relevant_files: list

    # Plan (planner tarafından doldurulur)
    plan: str

    # Aksiyon takibi
    current_step: int
    max_steps: int
    last_action: str
    last_result: str
    observation: str

    # Geçmiş
    messages: list
    errors: list

    # Son durum
    status: str  # running | completed | failed


# ═══════════════════════════════════════════════════════
# ROUTING FONKSİYONLARI
# ═══════════════════════════════════════════════════════


def _should_continue(state: AgentState) -> str:
    """
    Observer node'undan sonra hangi node'a gidileceğini belirle.

    Returns:
        "action"  → Devam et veya hata düzelt
        "summary_updater" → İş bitti, özetleri güncelle
    """
    import json, re

    # Maksimum adım kontrolü
    current_step = state.get("current_step", 0)
    max_steps = state.get("max_steps", 25)

    if current_step >= max_steps:
        logger.warning(
            "agent_max_steps_reached",
            project_id=state.get("project_id"),
            steps=current_step,
        )
        return "summary_updater"

    if _is_simple_text_edit_request(state.get("user_request", "")) and _has_successful_write(state):
        logger.info(
            "observer_forced_done_simple_edit",
            project_id=state.get("project_id"),
            step=current_step,
        )
        return "summary_updater"

    # Observer kararını JSON parse ederek güvenilir şekilde oku
    observation = state.get("observation", "")
    decision = "continue"  # varsayılan

    try:
        # Markdown code block içindeyse temizle
        clean = observation.strip()
        match = re.search(r"```(?:json)?\s*({.*?})\s*```", clean, re.DOTALL)
        if match:
            clean = match.group(1)
        elif clean.startswith("{"):
            pass  # Zaten düz JSON
        else:
            # Son çare: JSON bloğunu bul
            match = re.search(r"{.*}", clean, re.DOTALL)
            if match:
                clean = match.group(0)

        data = json.loads(clean)
        # Bazen model "decision" dönmez, "tool" vs döner, yani action node sandığını sanar
        if "decision" in data:
            decision = data.get("decision", "continue").lower()
        else:
            # model yanılmış ve action dönmüş
            obs_lower = observation.lower()
            if "done" in obs_lower:
                decision = "done"
            else:
                decision = "continue"

    except (json.JSONDecodeError, AttributeError):
        # Parse edilemezse raw string'e bak (geriye dönük uyumluluk)
        obs_lower = observation.lower()
        if "done" in obs_lower:
            decision = "done"
        elif "fix" in obs_lower:
            decision = "fix"
        else:
            decision = "continue"

    logger.debug(
        "observer_decision",
        project_id=state.get("project_id"),
        decision=decision,
        step=current_step,
    )

    if decision == "done":
        return "summary_updater"

    # LLM kararı "continue/fix" olsa da write→verify tamamlandıysa bitir.
    if _is_write_then_verify_completed(state):
        logger.info(
            "observer_forced_done_write_verified",
            project_id=state.get("project_id"),
            step=current_step,
        )
        return "summary_updater"

    # Aynı tool çıktısında takılı döngüleri kısa kes.
    if _is_stalled_same_tool_loop(state):
        logger.warning(
            "observer_forced_done_stalled_loop",
            project_id=state.get("project_id"),
            step=current_step,
        )
        return "summary_updater"

    # "continue" veya "fix" → action'a dön
    return "action"


# ═══════════════════════════════════════════════════════
# GRAPH OLUŞTURMA
# ═══════════════════════════════════════════════════════


def build_agent_graph() -> StateGraph:
    """
    LangGraph agent graph'ını oluştur.

    Graph yapısı:
        context_builder → planner → action → observer
                                        ↑        ↓
                                        ←── (continue/fix)
                                              ↓ (done)
                                        summary_updater → END
    """
    graph = StateGraph(AgentState)

    # Node'ları ekle
    graph.add_node("context_builder", context_builder_node)
    graph.add_node("planner", planner_node)
    graph.add_node("action", action_node)
    graph.add_node("observer", observer_node)
    graph.add_node("summary_updater", summary_updater_node)

    # Edge'leri tanımla
    graph.set_entry_point("context_builder")
    graph.add_edge("context_builder", "planner")
    graph.add_edge("planner", "action")
    graph.add_edge("action", "observer")

    # Conditional edge: observer'dan sonra devam mı, bitir mi
    graph.add_conditional_edges(
        "observer",
        _should_continue,
        {
            "action": "action",
            "summary_updater": "summary_updater",
        },
    )

    graph.add_edge("summary_updater", END)

    return graph


# Compiled graph (singleton)
_compiled_graph = None
_graph_lock = None


async def _get_graph_lock():
    """Asyncio lock'ı lazy olarak başlat."""
    global _graph_lock
    if _graph_lock is None:
        import asyncio
        _graph_lock = asyncio.Lock()
    return _graph_lock


async def get_compiled_graph():
    """Compiled graph instance'ını döndür (async-safe lazy init)."""
    global _compiled_graph
    if _compiled_graph is not None:
        return _compiled_graph
    lock = await _get_graph_lock()
    async with lock:
        if _compiled_graph is None:  # double-check
            graph = build_agent_graph()
            _compiled_graph = graph.compile()
    return _compiled_graph


# ═══════════════════════════════════════════════════════
# AGENT ÇALIŞTIRMA
# ═══════════════════════════════════════════════════════


# MongoDB koleksiyon ismi
AGENT_SESSIONS_COLLECTION = "agent_sessions"


async def run_agent(
    project_id: str,
    user_request: str,
    session_id: str,
    on_step_callback=None,
) -> dict:
    """
    Agent'ı çalıştır.

    Args:
        project_id: Hedef proje ID'si.
        user_request: Kullanıcının isteği.
        session_id: Bu çalışma için session ID.
        on_step_callback: Her adımda çağrılacak async callback
            (WebSocket bildirimi için).

    Returns:
        Son agent state.
    """
    db = Database.get_db()
    compiled = await get_compiled_graph()

    logger.info(
        "agent_run_start",
        project_id=project_id,
        session_id=session_id,
        request=user_request[:100],
    )

    # Session kaydı router üzerinden daha önceden eklendi
    # Başlangıç state'i
    initial_state: AgentState = {
        "project_id": project_id,
        "user_request": user_request,
        "session_id": session_id,
        "current_step": 0,
        "max_steps": 8 if _is_simple_text_edit_request(user_request) else 25,
        "messages": [],
        "errors": [],
        "status": "running",
    }

    # Projenin son aktivitesini güncelle (idle timeout sıfırla)
    from projects.service import update_last_activity
    await update_last_activity(db, project_id)

    # Graph'ı çalıştır
    final_state = initial_state
    try:
        async for step_output in compiled.astream(initial_state):
            # Her node çıktısında
            for node_name, node_state in step_output.items():
                final_state = {**final_state, **node_state}

                # Node'a göre doğru aksiyon metnini belirle (Mongo + WebSocket)
                if node_name == "observer":
                    # ÖNEMLİ: state.get() değil node_state.get() kullanıyoruz
                    # Çünkü final_state eski "last_action" alanını ezmediği için karışıyor
                    display_action = node_state.get("observation", final_state.get("observation", ""))
                elif node_name == "planner":
                    display_action = node_state.get("plan", final_state.get("plan", ""))
                elif node_name == "context_builder":
                    display_action = "Context oluşturuldu."
                elif node_name == "summary_updater":
                    display_action = "Özetler güncellendi."
                else:  # action
                    # action_node, dict dönerken "last_action" key'ine kaydeder
                    display_action = node_state.get("last_action", final_state.get("last_action", ""))

                # Step kaydını MongoDB'ye ekle
                step_record = {
                    "step_no": final_state.get("current_step", 0),
                    "node": node_name,
                    "action": display_action[:500],
                    "result": final_state.get("last_result", "")[:500],
                    "timestamp": datetime.now(timezone.utc),
                }

                await db[AGENT_SESSIONS_COLLECTION].update_one(
                    {"session_id": session_id},
                    {"$push": {"steps": step_record}},
                )

                # Callback (WebSocket bildirimi)
                if on_step_callback:
                    await on_step_callback({
                        "type": "step",
                        "step_no": step_record["step_no"],
                        "node": node_name,
                        "action": display_action[:500],  # Daha okunabilir olsun diye uzatıldı
                        "status": "success",
                    })

                # Aktivite güncelle
                await update_last_activity(db, project_id)

        # Başarılı tamamlandı
        await db[AGENT_SESSIONS_COLLECTION].update_one(
            {"session_id": session_id},
            {"$set": {"status": "completed"}},
        )

        logger.info(
            "agent_run_complete",
            session_id=session_id,
            total_steps=final_state.get("current_step", 0),
        )

    except Exception as e:
        # Hata
        await db[AGENT_SESSIONS_COLLECTION].update_one(
            {"session_id": session_id},
            {"$set": {
                "status": "failed",
                "error": str(e),
            }},
        )
        logger.error(
            "agent_run_failed",
            session_id=session_id,
            error=str(e),
        )
        final_state["status"] = "failed"

    return final_state
