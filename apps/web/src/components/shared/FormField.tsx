/**
 * FormField -- reusable form field wrapper (label + input + error).
 *
 * DRY: every form field in Vehicle/Order forms uses this instead
 * of duplicating label/error layout. Open/Closed: the `children`
 * slot accepts any input type without modifying this component.
 */

import type { ReactNode } from "react";

interface FormFieldProps {
  /** Label text shown above the input. */
  label: string;
  /** Field name for htmlFor/id linking. */
  name: string;
  /** Validation error message (from RHF). */
  error?: string;
  /** Optional hint shown below the input. */
  hint?: string;
  /** Whether the field is required (shows * indicator). */
  required?: boolean;
  /** The input element(s). */
  children: ReactNode;
}

export function FormField({
  label,
  name,
  error,
  hint,
  required = false,
  children,
}: FormFieldProps) {
  return (
    <div className={`form-field ${error ? "form-field--error" : ""}`}>
      <label className="form-field__label" htmlFor={name}>
        {label}
        {required && <span className="form-field__required">*</span>}
      </label>
      {children}
      {error && <p className="form-field__error">{error}</p>}
      {!error && hint && <p className="form-field__hint">{hint}</p>}
    </div>
  );
}
