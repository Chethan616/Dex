import React, { useCallback, useEffect, useRef, useState } from 'react';
import { closeAppPopup, openAnchoredAppPopup } from '../shared/appPopup';

export interface SelectableModel {
  id: string;
  label: string;
  hint?: string;
}

interface ModelPickerProps {
  /** Engine whose models are being offered; the list is owned by its adapter. */
  engineId: string;
  /** Selected model id, or '' for the engine's own default. */
  value: string;
  onChange: (modelId: string) => void;
  onOpenChange?: (open: boolean) => void;
}

/** Sentinel for "don't pass a model flag at all". */
export const DEFAULT_MODEL_ID = '';
const DEFAULT_ITEM_ID = '__default__';

function ChevronIcon(): React.ReactElement {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Model chooser shown beside the engine picker.
 *
 * The option list comes from the engine adapter (`selectableModels`) rather
 * than being hardcoded here, so adding a model is a one-line change next to
 * the flag that carries it. Engines that expose no models render nothing at
 * all — BrowserCode picks its model in Settings, so a second control here
 * would be a lie.
 */
export function ModelPicker({ engineId, value, onChange, onOpenChange }: ModelPickerProps): React.ReactElement | null {
  const [models, setModels] = useState<SelectableModel[]>([]);
  const [popupId, setPopupId] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const engines = (await window.electronAPI?.sessions?.listEngines?.()) ?? [];
        if (cancelled) return;
        setModels(engines.find((e) => e.id === engineId)?.selectableModels ?? []);
      } catch (err) {
        console.warn('[ModelPicker] listEngines failed', { error: (err as Error).message });
        if (!cancelled) setModels([]);
      }
    })();
    return () => { cancelled = true; };
  }, [engineId]);

  const openMenu = useCallback(async () => {
    const button = buttonRef.current;
    if (!button) return;
    if (popupId) {
      closeAppPopup(popupId);
      return;
    }
    onOpenChange?.(true);
    const nextId = await openAnchoredAppPopup(
      button,
      {
        kind: 'menu',
        placement: 'top-end',
        width: 208,
        items: [
          { id: DEFAULT_ITEM_ID, label: 'Default', hint: "Engine's own choice", checked: value === DEFAULT_MODEL_ID },
          ...models.map((m) => ({
            id: m.id,
            label: m.label,
            hint: m.hint,
            checked: m.id === value,
            separatorBefore: m.id === models[0]?.id,
          })),
        ],
      },
      {
        onAction: (action) => {
          if (action.kind !== 'menu-select') return;
          onChange(action.itemId === DEFAULT_ITEM_ID ? DEFAULT_MODEL_ID : action.itemId);
        },
        onClosed: () => {
          setPopupId(null);
          onOpenChange?.(false);
        },
      },
    );
    if (nextId) setPopupId(nextId);
    else onOpenChange?.(false);
  }, [models, onChange, onOpenChange, popupId, value]);

  // Nothing to choose between — don't show a control that cannot do anything.
  if (models.length === 0) return null;

  const current = models.find((m) => m.id === value);
  const label = current?.label ?? 'Default';

  return (
    <div className="model-picker">
      <button
        ref={buttonRef}
        type="button"
        className="model-picker__toggle"
        onClick={(e) => { e.stopPropagation(); void openMenu(); }}
        aria-haspopup="menu"
        aria-expanded={Boolean(popupId)}
        title={current ? `Model: ${current.label}` : "Model: engine's default"}
      >
        <span className="model-picker__name">{label}</span>
        <ChevronIcon />
      </button>
    </div>
  );
}
