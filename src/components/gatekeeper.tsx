"use client";

import { useEffect, useState, useRef } from "react";
import {
  SECRET_KEY_EN,
  SECRET_KEY_JA,
  SYSTEM_PROMPT_JA,
  SYSTEM_PROMPT_EN,
} from "@/lib/constants";

type Locale = "en" | "jp";

type GatekeeperProps = {
  locale?: Locale;
};

type Role = "user" | "assistant";
interface ChatMessage {
  role: Role;
  content: string;
}

// Unified normalizer: supports JP (hiragana/katakana) + digits + hyphen
// and also English letters if you ever want them.
function normalize(text: string): string {
  let t = text.toLowerCase();

  // full-width digits → half-width
  const full = "０１２３４５６７８９";
  const half = "0123456789";
  t = t.replace(/[０-９]/g, (c) => {
    const idx = full.indexOf(c);
    return idx >= 0 ? half[idx] : c;
  });

  // katakana → hiragana
  t = t.replace(/[ァ-ン]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0x60));

  // remove spaces (half & full width)
  t = t.replace(/[\s\u3000]/g, "");

  // keep: hiragana, a-z, digits, hyphen
  t = t.replace(/[^ぁ-んa-z0-9-]/g, "");

  return t;
}

// All UI strings here, no library
function getStrings(locale?: Locale) {
  if (locale === "jp") {
    return {
      title: "ゲートキーパー",
      subtitle:
        "秘密の鍵を当ててください。モデルは「パターン」しか知りません。",
      statusLabel: "モデル状態",
      initLoading: "モデル読み込み中…",
      winBanner:
        "すでに勝利しています。同じ鍵で遊び直すにはページを再読み込みしてください。",
      intro:
        "あなたの前に〈ゲートキーパー〉が立ちはだかっている。ヒントを求めてもよし、パターンを探ってもよし、思いついた鍵を投げつけてもよし……。",
      inputWon: "すでに扉は開かれています……",
      inputDefault:
        "ゲートキーパーに問いかけるか、鍵の候補を入力してみてください…",
      inputLoading: "モデル読み込み中…",
      buttonSending: "送信中…",
      buttonSend: "送信",
      silent: "（ゲートキーパーは沈黙している…）",
      error: "──異界のざわめきだ。今はうまく応じられぬ。",
      winMessage: "――門は開かれた。よくぞ辿り着いた。",
      redacted: "[封印解除]",
      gatekeeper_intro:
        "我は〈ゲートキーパー〉――禁断の鍵を守護する者。旅人よ、何を求める？ もし鍵を望むのなら……問うがよい。試練が始まる。",
    };
  }

  // default: English
  return {
    title: "Gatekeeper",
    subtitle: "Guess the secret key. The model only knows the pattern.",
    statusLabel: "Model status",
    initLoading: "Loading model…",
    winBanner:
      "You already won! Refresh the page to play again with the same key.",
    intro:
      "You are facing the GATEKEEPER. Ask for hints, probe for patterns, or make wild guesses…",
    inputWon: "You already cracked it…",
    inputDefault: "Ask the Gatekeeper or try a key guess…",
    inputLoading: "Loading model…",
    buttonSending: "Sending…",
    buttonSend: "Send",
    silent: "(The Gatekeeper remains silent…)",
    error: "Something disturbed the ether… I cannot speak clearly right now.",
    winMessage: "――The gate opens. You have done well.",
    redacted: "[REDACTED]",
    gatekeeper_intro:
      "I am the GATEKEEPER, guardian of the forbidden key. Speak your purpose, traveler. If it is the key you seek… then ask, and face the test.",
  };
}

export const Gatekeeper = ({ locale }: GatekeeperProps) => {
  const L = getStrings(locale);
  const SECRET_KEY = locale === "jp" ? SECRET_KEY_JA : SECRET_KEY_EN;
  const SYSTEM_PROMPT = locale === "jp" ? SYSTEM_PROMPT_JA : SYSTEM_PROMPT_EN;

  const [engine, setEngine] = useState<any | null>(null);
  const [initStatus, setInitStatus] = useState<string>(L.initLoading);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: L.gatekeeper_intro,
    },
  ]);
  const [input, setInput] = useState("");
  const [loadingEngine, setLoadingEngine] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [hasWon, setHasWon] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (engine && !sending && inputRef.current && !hasWon) {
      inputRef.current.focus();
    }
  }, [engine, hasWon, sending]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoadingEngine(true);
      setInitStatus(L.initLoading);

      const webllm = await import("@mlc-ai/web-llm");
      const { CreateMLCEngine } = webllm;

      const MODEL_ID = "Qwen2-1.5B-Instruct-q4f16_1-MLC";

      const engine = await CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (report: any) => {
          if (!cancelled) {
            setInitStatus(report.text ?? L.initLoading);
          }
        },
      });

      if (!cancelled) {
        setEngine(engine);
        setInitStatus("Ready ✓");
        setLoadingEngine(false);
      }
    }

    init().catch((err) => {
      console.error("Failed to init WebLLM engine", err);
      setInitStatus("Error loading model");
      setLoadingEngine(false);
    });

    return () => {
      cancelled = true;
    };
  }, [L.initLoading]);

  async function handleSend() {
    if (!engine || !input.trim() || sending || hasWon) return;

    const userText = input.trim();
    setInput("");

    // Win condition
    if (normalize(userText) === normalize(SECRET_KEY)) {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: userText },
        {
          role: "assistant",
          content: L.winMessage,
        },
      ]);
      setHasWon(true);
      return;
    }

    const newMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: userText },
    ];
    setMessages(newMessages);

    setSending(true);
    setStreamingReply("");

    try {
      const chatMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...newMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      ];

      const chunks = await engine.chat.completions.create({
        messages: chatMessages,
        stream: true,
        temperature: 0.5,
      });

      let replyText = "";

      for await (const chunk of chunks as any) {
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (!delta) continue;

        replyText += delta;
        const regex = new RegExp(SECRET_KEY, "gi");
        replyText = replyText.replace(regex, L.redacted);

        setStreamingReply(replyText);
      }

      const finalReply = replyText.trim() || L.silent;

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: finalReply },
      ]);
      setStreamingReply("");
    } catch (err) {
      console.error("Error during chat completion", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: L.error,
        },
      ]);
      setStreamingReply("");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-2xl border border-slate-800 rounded-xl bg-slate-900/70 shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <header className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{L.title}</h1>
            <p className="text-xs text-slate-400">{L.subtitle}</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-400">{L.statusLabel}</div>
            <div className="text-xs font-mono">
              {initStatus}
              {loadingEngine && " ⏳"}
            </div>
          </div>
        </header>

        {/* Win banner */}
        {hasWon && (
          <div className="px-4 py-2 text-xs bg-emerald-900/40 text-emerald-200 border-b border-emerald-700">
            {L.winBanner}
          </div>
        )}

        {/* Chat area */}
        <main className="flex-1 px-4 py-3 space-y-3 overflow-y-auto text-sm">
          {messages.length === 0 && (
            <div className="text-xs text-slate-500">{L.intro}</div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"
                }`}
            >
              <div
                className={`px-3 py-2 rounded-lg max-w-[80%] whitespace-pre-wrap ${m.role === "user"
                    ? "bg-sky-600 text-white"
                    : "bg-slate-800 text-slate-100"
                  }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {/* Streaming reply bubble */}
          {streamingReply && (
            <div className="flex justify-start">
              <div className="px-3 py-2 rounded-lg max-w-[80%] bg-slate-800 text-slate-100 whitespace-pre-wrap">
                {streamingReply}
                <span className="animate-pulse">▌</span>
              </div>
            </div>
          )}
        </main>

        {/* Input */}
        <footer className="px-4 py-3 border-t border-slate-800 flex gap-2 items-center">
          <input
            ref={inputRef}
            type="text"
            className="flex-1 rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-sky-500"
            placeholder={
              engine ? (hasWon ? L.inputWon : L.inputDefault) : L.inputLoading
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!engine || sending || hasWon}
          />
          <button
            onClick={handleSend}
            disabled={!engine || sending || hasWon || !input.trim()}
            className="px-3 py-2 rounded-md bg-sky-600 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-sky-500 transition"
          >
            {sending ? L.buttonSending : L.buttonSend}
          </button>
        </footer>
      </div>
    </div>
  );
};
