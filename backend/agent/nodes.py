"""
Agent modülü — LangGraph graph node'ları.

Her node, agent pipeline'ında bir adımdır:
  1. context_builder  → Proje bağlamını topla
  2. planner          → Yapılacakları planla
  3. action           → Tool çağır (dosya yaz, komut çalıştır vb.)
  4. observer         → Sonucu değerlendir, devam/düzelt/bitir
  5. summary_updater  → Değiştirilen dosyaların özetini güncelle
"""

from datetime import datetime, timezone

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
import structlog

from agent.memory.file_tree import get_file_tree
from agent.memory.summary import get_file_summaries, upsert_file_summary
from core.config import settings
from core.database import Database

logger = structlog.get_logger(__name__)

# LLM instance cache (modül başına bir kez oluştur)
_llm_instance = None


def _get_llm():
    """
    AI_PROVIDER ayarına göre LLM instance döndürür.
    "google"  → ChatGoogleGenerativeAI (Gemini vb.)
    "openrouter" → ChatOpenAI uyumlu, OpenRouter base URL ile.
    """
    global _llm_instance
    if _llm_instance is not None:
        return _llm_instance

    provider = (settings.AI_PROVIDER or "google").lower().strip()

    if provider == "openrouter":
        if not (settings.OPENROUTER_API_KEY or "").strip():
            raise RuntimeError(
                "AI ayarı eksik: AI_PROVIDER=openrouter ama OPENROUTER_API_KEY boş. "
                "backend/.env içine OPENROUTER_API_KEY=... ekleyip backend'i yeniden başlatın."
            )
        from langchain_openai import ChatOpenAI
        _llm_instance = ChatOpenAI(
            model=settings.AI_MODEL,
            api_key=settings.OPENROUTER_API_KEY,
            base_url=settings.OPENROUTER_BASE_URL,
            temperature=0.1,
            max_tokens=8192,
            default_headers={
                "HTTP-Referer": "https://github.com/ugurbagkuran/ai-code-reviewer",
                "X-Title": "AI Code Reviewer",
            },
        )
    elif provider == "openai":
        if not (settings.OPENAI_API_KEY or "").strip():
            raise RuntimeError(
                "AI ayarı eksik: AI_PROVIDER=openai ama OPENAI_API_KEY boş. "
                "backend/.env içine OPENAI_API_KEY=... ekleyip backend'i yeniden başlatın."
            )
        from langchain_openai import ChatOpenAI
        _llm_instance = ChatOpenAI(
            model=settings.AI_MODEL,
            api_key=settings.OPENAI_API_KEY,
            base_url=settings.OPENAI_BASE_URL,
            temperature=0.1,
            max_tokens=8192,
        )
    else:
        if not (settings.GOOGLE_API_KEY or "").strip():
            raise RuntimeError(
                "AI ayarı eksik: AI_PROVIDER=google ama GOOGLE_API_KEY boş. "
                "backend/.env içine GOOGLE_API_KEY=... ekleyip backend'i yeniden başlatın."
            )
        from langchain_google_genai import ChatGoogleGenerativeAI
        _llm_instance = ChatGoogleGenerativeAI(
            model=settings.AI_MODEL,
            google_api_key=settings.GOOGLE_API_KEY,
            temperature=0.1,
            max_tokens=8192,
        )

    logger.info("llm_initialized", provider=provider, model=settings.AI_MODEL)
    return _llm_instance


def _extract_text(content) -> str:
    """
    LLM çıktısını güvenli şekilde string'e çevirir.
    'Thinking' modelleri liste formatında [{'type': 'thinking', ...}, {'type': 'text', 'text': '...'}] döner.
    """
    if isinstance(content, list):
        return " ".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in content])
    return str(content)


def _request_expects_html(user_request: str) -> bool:
    """Kullanıcı isteğinde HTML/sayfa beklentisi var mı?"""
    req = (user_request or "").lower()
    keywords = ("html", "sayfa", "page", "web")
    return any(k in req for k in keywords)


def _is_simple_text_edit_request(user_request: str) -> bool:
    """
    Kısa ve doğrudan dosya düzenleme isteklerini tespit eder.

    Bu tür işlerde ajanı gereksiz planlama / restart döngüsüne sokmamak için
    graph tarafında erken durdurma ve action tarafında daha sıkı kurallar uygularız.
    """
    req = (user_request or "").lower()
    edit_keywords = (
        "değiştir",
        "degistir",
        "düzenle",
        "duzenle",
        "çevir",
        "cevir",
        "replace",
        "rename",
        "isimlerini",
        "adlarını",
        "adlarini",
        "yaz",
        "ekle",
        "sil",
    )
    runtime_keywords = (
        "çalıştır",
        "calistir",
        "run",
        "build",
        "test",
        "compile",
        "restart",
        "server",
        "sunucu",
        "npm",
        "python",
        "gcc",
        "node",
    )
    return any(k in req for k in edit_keywords) and not any(k in req for k in runtime_keywords)


def _extract_simple_replace_request(user_request: str) -> dict | None:
    """
    Tek dosyada kelime/değer değiştirme isteklerini ayıklar.

    Örnek:
      "index.html deki day ve night isimlerini aydinlik ve karanlik olarak değiştir"
    """
    import re

    req = (user_request or "").strip()
    normalized = req.casefold()
    old_marker = " deki "
    old_terms_marker = " isimlerini "
    new_terms_marker = " olarak "

    old_start = normalized.find(old_marker)
    old_terms_start = normalized.find(old_terms_marker, old_start + len(old_marker)) if old_start >= 0 else -1
    new_terms_start = normalized.find(new_terms_marker, old_terms_start + len(old_terms_marker)) if old_terms_start >= 0 else -1
    if min(old_start, old_terms_start, new_terms_start) < 0:
        return None

    path = req[:old_start].strip(" \"'`")
    if not path:
        return None

    def _split_terms(text: str) -> list[str]:
        parts = [part.strip(" ,;:.\"'`") for part in re.split(r"\s+ve\s+|,\s*", text) if part.strip(" ,;:.\"'`")]
        return parts

    old_terms = _split_terms(req[old_start + len(old_marker):old_terms_start])
    new_terms = _split_terms(req[old_terms_start + len(old_terms_marker):new_terms_start].replace("isimlerini", ""))
    if not old_terms or len(old_terms) != len(new_terms):
        return None

    return {
        "path": path,
        "pairs": list(zip(old_terms, new_terms)),
    }


def _extract_json_payload(raw: str) -> dict | None:
    """LLM çıktısından JSON payload çıkarır."""
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


def _looks_like_html(content: str) -> bool:
    """İçeriğin HTML dokümanı gibi görünüp görünmediğini kontrol eder."""
    lowered = (content or "").lower()
    return "<!doctype html" in lowered or "<html" in lowered


def _normalize_html_write_action(action_json: str, user_request: str) -> str:
    """
    HTML/sayfa isteklerinde *.html write_file içeriğini güvenli şekilde normalize et.
    Model sadece düz metin üretirse tam HTML iskeleti içine sarar.
    """
    import html
    import json

    if not _request_expects_html(user_request):
        return action_json

    data = _extract_json_payload(action_json)
    if not data:
        return action_json

    tool = (data.get("tool") or "").strip().lower()
    args = data.get("args") or {}
    path = str(args.get("path", "")).strip()

    if tool != "write_file" or not path.lower().endswith(".html"):
        return action_json

    raw_content = str(args.get("content", ""))
    if _looks_like_html(raw_content):
        return action_json

    heading_text = raw_content.strip() or "Hello World"
    page_title = "Hello World" if "hello world" in (user_request or "").lower() else "Web Sayfasi"
    safe_heading = html.escape(heading_text)
    safe_title = html.escape(page_title)

    args["content"] = (
        "<!doctype html>\n"
        "<html lang=\"tr\">\n"
        "<head>\n"
        "  <meta charset=\"UTF-8\" />\n"
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n"
        f"  <title>{safe_title}</title>\n"
        "</head>\n"
        "<body>\n"
        f"  <h1>{safe_heading}</h1>\n"
        "</body>\n"
        "</html>"
    )

    data["args"] = args
    return json.dumps(data, ensure_ascii=False, indent=2)


def _format_recent_action_trace(messages: list[dict]) -> str:
    """Observer için son action/tool izini kısa formatta döndürür."""
    lines = []
    for msg in messages[-12:]:
        if msg.get("node") != "action":
            continue
        role = msg.get("role", "")
        if role not in ("assistant", "tool"):
            continue
        content = str(msg.get("content", ""))[:300]
        lines.append(f"[{role}/action]: {content}")
    return "\n".join(lines) if lines else "(yok)"


# ═══════════════════════════════════════════════════════
# NODE 1: CONTEXT BUILDER
# ═══════════════════════════════════════════════════════


async def context_builder_node(state: dict) -> dict:
    """
    Proje bağlamını topla ve state'e yaz.

    1. Sidecar'dan dosya ağacını çek
    2. MongoDB'den dosya özetlerini al
    3. (RAG ile ilgili dosyaları bul — Qdrant aktifse)
    """
    project_id = state["project_id"]

    logger.info("node_context_builder", project_id=project_id)

    # 1. Dosya ağacı
    try:
        file_tree = await get_file_tree(project_id)
    except Exception as e:
        file_tree = f"(Dosya ağacı alınamadı: {e})"
        logger.warning("file_tree_failed", error=str(e))

    # 2. Dosya özetleri
    db = Database.get_db()
    summaries = await get_file_summaries(db, project_id)
    summaries_text = "\n".join(
        f"- {s['file_path']}: {s['summary']}"
        for s in summaries
    ) if summaries else "(Henüz dosya özeti yok)"

    # 3. RAG ile ilgili dosyalar (ileride Qdrant aktif olunca)
    relevant_files = []
    # try:
    #     from agent.rag.retriever import get_relevant_files
    #     query_embedding = await embed_query(state["user_request"])
    #     relevant_files = await get_relevant_files(project_id, query_embedding)
    # except Exception:
    #     pass

    return {
        **state,
        "file_tree": file_tree,
        "file_summaries": summaries_text,
        "relevant_files": relevant_files,
        "current_step": state.get("current_step", 0),
    }


# ═══════════════════════════════════════════════════════
# NODE 2: PLANNER
# ═══════════════════════════════════════════════════════


async def planner_node(state: dict) -> dict:
    """
    Kullanıcı isteğini analiz et ve yapılacakları planla.

    LLM'e proje bağlamı + istek gönderir, adım adım plan alır.
    """
    logger.info("node_planner", project_id=state["project_id"])

    llm = _get_llm()

    system_prompt = """Sen bir yazılım mühendisi AI agent'sın.
Kullanıcının isteğini analiz et ve bir aksiyon planı oluştur.

Kullanabileceğin araçlar (SADECE BUNLAR — başka tool YOK):
- read_file(path): Dosya oku
- write_file(path, content): Dosya yaz (dizin yoksa otomatik oluşturur, mkdir gerekmez)
- delete_file(path): Dosya sil
- list_files(directory): Dizin listele
- run_command(command): Shell komutu çalıştır
- restart_service(): Servisi yeniden başlat
- get_logs(lines): Log oku

NOT: create_directory, mkdir, touch gibi tool'lar YOKTUR. Dizin oluşturmak için write_file kullan.

Kurallar:
1. Önce mevcut kodu anla, sonra değişiklik yap.
2. Minimum gerekli değişikliği yap, gereksiz dosyalara dokunma.
3. Her adımda ne yapacağını açıkla.
4. Hata olursa logları kontrol et ve düzelt.
5. İşin bitince restart_service() çağır.
6. Basit metin/dosya düzenlemelerinde restart_service kullanma; write_file sonrası dur.

Planını JSON formatında döndür:
{
    "analysis": "İsteğin kısa analizi",
    "steps": [
        {"action": "read_file", "path": "src/main.py", "reason": "Mevcut kodu anla"},
        {"action": "write_file", "path": "src/utils.py", "reason": "Yardımcı fonksiyon ekle"},
        ...
    ]
}"""

    context = f"""
PROJE DOSYA AĞACI:
{state.get('file_tree', '(yok)')}

DOSYA ÖZETLERİ:
{state.get('file_summaries', '(yok)')}

KULLANICI İSTEĞİ:
{state['user_request']}
"""

    if _is_simple_text_edit_request(state.get("user_request", "")):
        context += "\nNOT: Bu istek basit bir dosya/metin düzenlemesi. Gereksiz komut çalıştırma ve restart_service kullanma."

    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=context),
    ]

    response = await llm.ainvoke(messages)
    content_str = _extract_text(response.content)

    return {
        **state,
        "plan": content_str,
        "messages": state.get("messages", []) + [
            {"role": "assistant", "content": content_str, "node": "planner"}
        ],
    }


# ═══════════════════════════════════════════════════════
# NODE 3: ACTION
# ═══════════════════════════════════════════════════════


async def action_node(state: dict) -> dict:
    """
    Plan'a göre tool çağrısı yap.

    LLM'e mevcut durumu ve planı vererek hangi tool'u
    hangi parametrelerle çağıracağını sorar.
    Tool'u çalıştırır ve sonucu state'e yazar.
    """
    step = state.get("current_step", 0) + 1
    logger.info(
        "node_action",
        project_id=state["project_id"],
        step=step,
    )

    user_request = state.get("user_request", "")
    simple_edit_mode = _is_simple_text_edit_request(user_request)

    simple_replace = _extract_simple_replace_request(user_request) if simple_edit_mode else None
    if simple_replace:
        from sandbox.client import SandboxClient
        import json
        import re

        client = SandboxClient(state["project_id"])
        source_path = simple_replace["path"]
        read_result = await client.read_file(source_path)
        original_content = read_result.get("content", "")

        updated_content = original_content
        for old_text, new_text in simple_replace["pairs"]:
            updated_content = re.sub(re.escape(old_text), new_text, updated_content)

        action_payload = {
            "tool": "write_file",
            "args": {
                "path": source_path,
                "content": updated_content,
            },
            "reason": "Basit metin değişikliği için mevcut içeriği koruyarak hedef ifadeleri değiştirdim.",
        }
        normalized_action = json.dumps(action_payload, ensure_ascii=False, indent=2)
        tool_result = await _execute_tool(state["project_id"], normalized_action)

        return {
            **state,
            "current_step": step,
            "last_action": normalized_action,
            "last_result": tool_result,
            "messages": state.get("messages", []) + [
                {"role": "assistant", "content": normalized_action, "node": "action"},
                {"role": "tool", "content": tool_result, "node": "action"},
            ],
        }

    llm = _get_llm()
    html_rule = ""
    if _request_expects_html(user_request):
        html_rule = """
EK HTML KURALI (ZORUNLU):
- *.html dosyasına yazarken content tam HTML dokümanı olmalı.
- En az <!doctype html>, <html>, <head>, <body> etiketleri bulunmalı.
- Sadece düz metin (ör. sadece 'Hello World') yazma.
"""

    simple_edit_rule = ""
    if simple_edit_mode:
        simple_edit_rule = """
SIMPLE EDIT KURALI:
- Kullanıcı kısa bir metin/dosya değişikliği istiyor.
- En fazla 1 read_file ve 1 write_file kullan.
- restart_service kullanma.
- Gereksiz test/derleme komutu çalıştırma.
- Dosya değiştiyse işi burada bitir; ekstra doğrulama döngüsüne girme.
"""

    # Tool çağrısı için prompt
    action_prompt = f"""Mevcut adım: {step}
Plan: {state.get('plan', '')}

Kullanıcı isteği:
{user_request}

Önceki mesajlar:
{_format_messages(state.get('messages', []))}

{html_rule}
{simple_edit_rule}

Şimdi hangi aksiyonu alman gerekiyor? Tek bir tool çağrısı yap.
Respond with a JSON:
{{
    "tool": "tool_name",
    "args": {{"arg1": "value1"}},
    "reason": "Bu adımı neden yapıyorum"
}}
"""

    messages = [
        SystemMessage(content=(
            "Sen bir kod yazma agent'sın. Verilen plan doğrultusunda tek bir adım gerçekleştir. "
            "Tool JSON formatına kesinlikle uy. HTML/sayfa isteklerinde *.html içeriğini tam HTML dokümanı olarak üret. "
            "Basit metin düzenlemelerinde restart_service çağırma."
        )),
        HumanMessage(content=action_prompt),
    ]

    response = await llm.ainvoke(messages)
    content_str = _extract_text(response.content)
    normalized_action = _normalize_html_write_action(content_str, user_request)

    # Tool çağrısını gerçekleştir
    tool_result = await _execute_tool(
        state["project_id"],
        normalized_action,
    )

    return {
        **state,
        "current_step": step,
        "last_action": normalized_action,
        "last_result": tool_result,
        "messages": state.get("messages", []) + [
            {"role": "assistant", "content": normalized_action, "node": "action"},
            {"role": "tool", "content": tool_result, "node": "action"},
        ],
    }


# ═══════════════════════════════════════════════════════
# NODE 4: OBSERVER
# ═══════════════════════════════════════════════════════


async def observer_node(state: dict) -> dict:
    """
    Action sonucunu değerlendir ve karar ver:
    - continue: Devam et (sıradaki adım)
    - fix: Hata var, düzelt
    - done: İş bitti
    """
    logger.info(
        "node_observer",
        project_id=state["project_id"],
        step=state.get("current_step", 0),
    )

    llm = _get_llm()
    recent_trace = _format_recent_action_trace(state.get("messages", []))

    observe_prompt = f"""Son aksiyonun sonucu:
{state.get('last_result', '')}

Plan: {state.get('plan', '')}

Son action/tool izi:
{recent_trace}

Mevcut adım: {state.get('current_step', 0)}
Maksimum adım: {state.get('max_steps', 25)}

Değerlendir:
1. Hata var mı?
2. Plan tamamlandı mı?
3. Bir sonraki adım ne olmalı?

Karar kuralları:
- Bir write_file başarılı olduysa ve doğrulama adımı (list_files/read_file) dosyayı gösteriyorsa "done" dön.
- Aynı tool aynı amaçla tekrar ediyorsa ve yeni ilerleme yoksa "done" dön.
- Sadece gerçekten yeni, gerekli bir adım varsa "continue" dön.
- Sadece hata çözümü gerekiyorsa "fix" dön.

CEVABINI ZORUNLU OLARAK AŞAĞIDAKİ EXACT JSON FORMATINDA VER:
{{
    "decision": "continue" | "fix" | "done",
    "reasoning": "Plan başarıyla tamamlandı, bu yüzden done dönüyorum.",
    "error": null
}}
Hiçbir tool, komut veya dosya yazma JSON'u DÖNDÜRME. Sistem şu an senin kod yazmanı DEĞİL, çalışmanı bitirip bitirmediğini puanlamanı bekliyor.
"""

    messages = [
        SystemMessage(content="DİKKAT: Sen sadece bir denetçisin (OBSERVER). Kod yazmamalısın. Çıktın 'continue', 'fix' ya da 'done' seçeneklerinden birini içeren basit bir JSON olmalıdır."),
        HumanMessage(content=observe_prompt),
    ]

    response = await llm.ainvoke(messages)
    content_str = _extract_text(response.content)

    return {
        **state,
        "observation": content_str,
        "messages": state.get("messages", []) + [
            {"role": "assistant", "content": content_str, "node": "observer"}
        ],
    }


# ═══════════════════════════════════════════════════════
# NODE 5: SUMMARY UPDATER
# ═══════════════════════════════════════════════════════


async def summary_updater_node(state: dict) -> dict:
    """
    Değiştirilen dosyaların özetlerini güncelle.

    Agent'ın bir sonraki çalışmasında bağlam olarak
    kullanılacak dosya özetlerini MongoDB'ye yazar.
    """
    logger.info("node_summary_updater", project_id=state["project_id"])

    # Değiştirilen dosyaları bul (mesajlardan)
    modified_files = _extract_modified_files(state.get("messages", []))

    if not modified_files:
        return {**state, "status": "completed"}

    db = Database.get_db()
    llm = _get_llm()

    for file_path in modified_files:
        try:
            # Dosya içeriğini oku
            from sandbox.client import SandboxClient
            client = SandboxClient(state["project_id"])
            result = await client.read_file(file_path)
            content = result.get("content", "")

            if not content:
                continue

            # LLM ile özet oluştur
            summary_prompt = f"""Bu dosyanın ne yaptığını tek cümlede özetle:

Dosya: {file_path}
İçerik:
{content[:2000]}
"""
            response = await llm.ainvoke([
                HumanMessage(content=summary_prompt)
            ])
            content_str = _extract_text(response.content)

            await upsert_file_summary(
                db=db,
                project_id=state["project_id"],
                file_path=file_path,
                summary=content_str.strip(),
            )

        except Exception as e:
            logger.warning(
                "summary_update_failed",
                file_path=file_path,
                error=str(e),
            )

    return {**state, "status": "completed"}


# ═══════════════════════════════════════════════════════
# YARDIMCI FONKSİYONLAR
# ═══════════════════════════════════════════════════════


def _format_messages(messages: list[dict]) -> str:
    """Mesaj geçmişini okunabilir formata çevir."""
    lines = []
    for msg in messages[-10:]:  # Son 10 mesaj
        role = msg.get("role", "unknown")
        node = msg.get("node", "")
        content = msg.get("content", "")[:500]
        lines.append(f"[{role}/{node}]: {content}")
    return "\n".join(lines) if lines else "(boş)"


# ═══════════════════════════════════════════════════════
# NODE 6: REVIEWER
# ═══════════════════════════════════════════════════════


async def reviewer_node(state: dict) -> dict:
    """
    Değiştirilen dosyaları code review'dan geçir.

    summary_updater bittikten sonra çalışır.
    Her yazılan dosyayı okur, LLM ile inceler,
    yapılandırılmış bulgular (findings) üretir.
    """
    logger.info("node_reviewer", project_id=state["project_id"])

    modified_files = _extract_modified_files(state.get("messages", []))
    if not modified_files:
        return {**state, "review_findings": [], "status": "completed"}

    from sandbox.client import SandboxClient
    from langchain_core.messages import HumanMessage as HM
    client = SandboxClient(state["project_id"])
    llm = _get_llm()

    all_findings = []

    for file_path in modified_files:
        try:
            result = await client.read_file(file_path)
            content = result.get("content", "")
            if not content:
                continue

            review_prompt = f"""Sen deneyimli bir code reviewer'sın. Aşağıdaki dosyayı incele.

Dosya: {file_path}
İçerik:
```
{content[:4000]}
```

Güvenlik açıkları, hatalar, kötü pratikler ve iyileştirme önerilerini bul.
SADECE JSON listesi döndür, başka metin ekleme:

[
  {{
    "severity": "error",
    "line": 12,
    "message": "XSS açığı — kullanıcı girdisi sanitize edilmemiş",
    "suggestion": "innerHTML yerine textContent kullan"
  }},
  {{
    "severity": "warning",
    "line": 7,
    "message": "meta viewport eksik",
    "suggestion": "<meta name='viewport' content='width=device-width, initial-scale=1'> ekle"
  }}
]

severity değerleri: "error" (kritik), "warning" (orta), "info" (öneri)
Bulgu yoksa boş liste [] döndür."""

            response = await llm.ainvoke([HM(content=review_prompt)])
            raw = _extract_text(response.content).strip()

            import json, re
            match = re.search(r"\[.*\]", raw, re.DOTALL)
            if match:
                try:
                    findings = json.loads(match.group(0))
                    for f in findings:
                        f["file"] = file_path
                    all_findings.extend(findings)
                except json.JSONDecodeError:
                    pass

        except Exception as e:
            logger.warning("review_failed", file_path=file_path, error=str(e))

    logger.info(
        "reviewer_done",
        project_id=state["project_id"],
        findings=len(all_findings),
    )

    return {**state, "review_findings": all_findings, "status": "completed"}


def _extract_modified_files(messages: list[dict]) -> list[str]:
    """
    Mesaj geçmişinden değiştirilen dosya yollarını çıkar.

    write_file tool çağrılarından dosya yollarını toplar.
    """
    modified = set()
    for msg in messages:
        content = msg.get("content", "")
        if "write_file" in content and "path" in content:
            # Basit çıkarım — LLM çıktısından path'i bul
            import re
            paths = re.findall(r'"path":\s*"([^"]+)"', content)
            modified.update(paths)

            # "Dosya yazıldı:" formatından da çıkar
            written = re.findall(r"Dosya yazıldı:\s*(\S+)", content)
            modified.update(written)

    return list(modified)


async def _execute_tool(project_id: str, llm_response: str) -> str:
    """
    LLM'in JSON çıktısını parse edip ilgili tool'u çalıştır.

    Args:
        project_id: Proje ID'si.
        llm_response: LLM'den gelen JSON string.

    Returns:
        Tool çalıştırma sonucu.
    """
    import json

    try:
        # Gemini bazı durumlarda response.content'i string yerine list döndürebilir.
        if isinstance(llm_response, list):
            llm_response = " ".join([c.get("text", "") if isinstance(c, dict) else str(c) for c in llm_response])

        # JSON'u parse et (markdown code block içinde olabilir)
        import re
        clean = llm_response.strip()

        # Önce ```json ... ``` veya ``` ... ``` pattern'ini dene
        match = re.search(r"```(?:json)?\s*({.*?})\s*```", clean, re.DOTALL)
        if match:
            clean = match.group(1).strip()
        elif "{" in clean:
            # Düz JSON bloğu bul
            start = clean.index("{")
            end = clean.rindex("}") + 1
            clean = clean[start:end]

        data = json.loads(clean)
        tool_name = data.get("tool", "")
        args = data.get("args", {})
    except (json.JSONDecodeError, ValueError, KeyError) as e:
        return f"Tool parse hatası: {e}. LLM çıktısı: {llm_response[:200]}"

    from sandbox.client import SandboxClient
    client = SandboxClient(project_id)

    def _path(a: dict) -> str:
        """LLM bazen 'target', bazen 'path' kullanır — ikisini de kabul et."""
        return a.get("path") or a.get("target") or ""

    try:
        if tool_name == "read_file":
            result = await client.read_file(_path(args))
            return result.get("content", "")

        elif tool_name == "write_file":
            p = _path(args)
            await client.write_file(p, args.get("content", ""))
            return f"Dosya yazıldı: {p}"

        elif tool_name == "delete_file":
            p = _path(args)
            await client.delete_file(p)
            return f"Dosya silindi: {p}"

        elif tool_name == "list_files":
            target_dir = args.get("directory") or _path(args) or "/"
            result = await client.list_files(target_dir)
            files = result.get("files", [])
            return "\n".join(
                item.get("name", str(item)) if isinstance(item, dict) else str(item)
                for item in files
            )

        elif tool_name == "run_command":
            result = await client.exec_command(
                args.get("command", ""),
                timeout=args.get("timeout", 30),
            )
            stdout = result.get("stdout", "")
            stderr = result.get("stderr", "")
            exit_code = result.get("exit_code", -1)
            return f"Exit: {exit_code}\nSTDOUT:\n{stdout}\nSTDERR:\n{stderr}"

        elif tool_name == "restart_service":
            result = await client.restart_service()
            return result.get("message", "Servis yeniden başlatıldı.")

        elif tool_name == "get_logs":
            result = await client.get_logs(args.get("lines", 50))
            return result.get("logs", "")

        else:
            return f"Bilinmeyen tool: {tool_name}"

    except Exception as e:
        logger.error(
            "tool_execution_failed",
            tool=tool_name,
            error=str(e),
        )
        return f"Tool hatası ({tool_name}): {e}"
