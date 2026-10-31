import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldMeta {
  label: string;
  hint?: string;
  error?: string;
}

function describedBy(id: string, hint?: string, error?: string) {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function FieldMessages({ id, hint, error }: { id: string; hint?: string; error?: string }) {
  return (
    <>
      {error ? (
        <p className="field__error" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </>
  );
}

export function TextField({ label, hint, error, ...input }: FieldMeta & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...input}
      />
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextAreaField({ label, hint, error, ...input }: FieldMeta & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="field__input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...input}
      />
      <FieldMessages id={id} hint={hint} error={error} />
    </div>
  );
}

interface ChoiceChipsProps<T extends string> {
  legend: string;
  name: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  hint?: string;
  error?: string;
  visuallyHiddenLegend?: boolean;
}

// A single-choice group built from real radio buttons, styled as chips.
export function ChoiceChips<T extends string>({
  legend,
  name,
  options,
  value,
  onChange,
  hint,
  error,
  visuallyHiddenLegend,
}: ChoiceChipsProps<T>) {
  const id = useId();
  return (
    <fieldset className="fieldset" aria-describedby={describedBy(id, hint, error)}>
      <legend className={visuallyHiddenLegend ? 'visually-hidden' : 'fieldset__legend'}>{legend}</legend>
      <div className="chips">
        {options.map((option) => (
          <label key={option.value} className="chip">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <FieldMessages id={id} hint={hint} error={error} />
    </fieldset>
  );
}
