/** UI date-input helpers plus exports from the reusable preliminary transfer model. */
export { calculateEarthMoonTransfer, ORBIT_ASSUMPTIONS } from '../../../../packages/lunar-core/src/orbit';
export type { EarthMoonTransferPlan, TransferBurn } from '../../../../packages/lunar-core/src/orbit';

/** Convert a local datetime-local input value into a Date. */
export function parseLocalDateTime(value: string): Date {
  const parsed = new Date(value);
  if (!value || !Number.isFinite(parsed.getTime())) {
    throw new RangeError('Choose a valid arrival date and time');
  }
  return parsed;
}

/** Format a Date into the local wall-clock format required by datetime-local. */
export function toLocalDateTimeInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
