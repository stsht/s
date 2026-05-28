import { DateTimeField } from './DateTimeField.jsx';

/**
 * DateField
 *
 * Compatibility wrapper around the unified DateTimeField. Earlier
 * call sites (InvoiceComposer event/issued date) imported DateField
 * directly; instead of churning every import we keep this name and
 * forward to DateTimeField with `withTime` disabled so all date
 * editors across /db, /inv, and /subs share the same look, paste
 * UX, and custom calendar popover.
 *
 * New code should prefer `DateTimeField` directly — it accepts the
 * same `value`/`onChange` for the date side and adds optional
 * `timeValue`/`onTimeChange` props for the time side.
 */
export function DateField({ value, onChange, ariaLabel, id }) {
  return (
    <DateTimeField
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      id={id}
    />
  );
}
