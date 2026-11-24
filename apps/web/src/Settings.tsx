import { useEffect, useRef } from "react";
import { MODELS, type Model, type Provider } from "@agent/shared";

export type SettingsValue = { provider: Provider; model: Model; apiKey: string };

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  sarvam: "Sarvam",
};

export function providerLabel(p: Provider) {
  return PROVIDER_LABEL[p];
}

/** A modal (native <dialog>: focus trap, Esc to close). */
export function Settings({
  open,
  value,
  onChange,
  onClose,
}: {
  open: boolean;
  value: SettingsValue;
  onChange: (value: SettingsValue) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current!;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="modal" onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()}>
      <h2>Settings</h2>
      <label>
        Provider
        <select
          value={value.provider}
          onChange={(e) => {
            // Switching provider switches the model list, so pick that provider's default.
            const provider = e.target.value as Provider;
            onChange({ ...value, provider, model: MODELS[provider][0] });
          }}
        >
          {(Object.keys(MODELS) as Provider[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        <select value={value.model} onChange={(e) => onChange({ ...value, model: e.target.value as Model })}>
          {MODELS[value.provider].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        API key
        <input
          type="password"
          autoComplete="off"
          placeholder="Stays in this tab only"
          value={value.apiKey}
          onChange={(e) => onChange({ ...value, apiKey: e.target.value })}
        />
      </label>
      <button className="primary" onClick={onClose}>
        Done
      </button>
    </dialog>
  );
}
