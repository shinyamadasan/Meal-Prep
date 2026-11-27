// The household calendar day (PROP-041 owner decision 1, TASK-092). Food-safety verdicts are
// counted in whole calendar days, and the app counts them in the phone's local calendar
// (todayISO()). A stateless Worker has no caller time zone, so the household's zone is ONE Worker
// setting, `HOUSEHOLD_TIME_ZONE` (wrangler.jsonc `vars`, "Asia/Manila"), not a per-person value.
//
// Pure apart from Intl: the clock is injected. A missing or invalid zone fails closed with an
// InfrastructureError (the read fails) rather than guessing a day — a wrong day can turn an
// expired lot into a usable one.
import { InfrastructureError } from './firestore.js';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function formatterFor(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone.trim()) {
    throw new InfrastructureError('HOUSEHOLD_TIME_ZONE is not configured.');
  }
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  } catch (cause) {
    throw new InfrastructureError('HOUSEHOLD_TIME_ZONE is not a valid time zone.', cause);
  }
}

// `now` is a Date or epoch milliseconds (default: the real clock).
export function householdDay(timeZone, now = Date.now()) {
  const instant = now instanceof Date ? now.getTime() : now;
  if (typeof instant !== 'number' || !Number.isFinite(instant)) {
    throw new InfrastructureError('The household day could not be computed (invalid clock).');
  }
  const parts = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  const day = parts.year + '-' + parts.month + '-' + parts.day;
  if (!DATE_ONLY.test(day)) {
    throw new InfrastructureError('The household day could not be computed.');
  }
  return day;
}

// The day for one request, from the Worker's env and an optional injected clock (tests).
export function householdDayFromEnv(env, now) {
  return householdDay(env && env.HOUSEHOLD_TIME_ZONE, typeof now === 'function' ? now() : Date.now());
}
