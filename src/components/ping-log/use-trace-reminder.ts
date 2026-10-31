"use client";

import { useCallback, useState, type RefObject } from "react";

import { dropExpired, madeWith, serviceWorkerReady, unsubscribe } from "@/lib/ping-log/push";
import { fetchPublicConfig, type PublicConfig } from "@/lib/trace-api/client";
import {
  ENDED_MESSAGE,
  ReminderError,
  changeTraceReminderInterval,
  loadTraceReminder,
  markTraceReminderEnded,
  nextTraceReminderAt,
  saveTraceReminder,
  startingInterval,
  switchOffTraceReminder,
  switchOnTraceReminder,
  type TraceReminder,
} from "@/lib/trace-api/reminder";
import type { TabExperience } from "@/lib/trace-api/session";

import type { ReminderTerms } from "./ray/screens";

/**
 * The photo reminder through TRACE_B (#17) for PingLogScreen, while the tab
 * holds a memory credential (`experience`); without one, `reminder` is null
 * and the push worker's reminder applies as before. The browser's push
 * subscription stays PingLogScreen's state, shared with the push worker's
 * plan; `owned` says when it is TRACE_B's, which that plan never claims.
 *
 * Off is a DELETE, not a pause: an off switch should leave nothing on TRACE_B
 * that could send, and switching on again needs no new permission anyway.
 * The tasks throw their refusals; the caller shows them beside the switch.
 */

type Options = {
  experience: TabExperience | null;
  config: PublicConfig | null;
  setConfig: (config: PublicConfig) => void;
  subscription: PushSubscription | null;
  setSubscription: (subscription: PushSubscription | null) => void;
  /** Cleared when the push worker's own subscription is handed back to it. */
  setWorkerExpiresAt: (value: string | null) => void;
  registration: RefObject<ServiceWorkerRegistration | null>;
  now: number;
};

export function useTraceReminder({ experience, config, setConfig, subscription, setSubscription, setWorkerExpiresAt, registration, now }: Options) {
  const [stored, setStored] = useState<TraceReminder | null>(loadTraceReminder);

  const key = config?.notification?.vapidPublicKey ?? "";
  const owned = subscription !== null && ((key !== "" && madeWith(subscription, key) === true) || subscription.endpoint === stored?.active?.endpoint);

  const record = experience && stored?.memorySessionId === experience.memory.memorySessionId ? stored : null;
  const ended = experience !== null && (experience.status !== "main" || Date.parse(experience.memory.expiresAt) <= now);
  const active =
    !ended && record?.active && subscription?.endpoint === record.active.endpoint && Date.parse(record.active.expiresAt) > now ? record.active : null;
  const terms: ReminderTerms = {
    intervalMinutes: record?.intervalMinutes ?? startingInterval(config?.notification),
    choices: config?.notification?.allowedIntervalsMinutes ?? [],
    stops: "arrival",
  };
  const reminder = experience ? { on: active !== null, nextAt: active && nextTraceReminderAt(active, terms.intervalMinutes, now), terms } : null;

  const keep = (next: TraceReminder | null) => {
    saveTraceReminder(next);
    setStored(next);
  };

  /**
   * After a refusal meaning TRACE_B no longer sends to this browser, the phone
   * lets go of the subscription too, and after arrival the switch stays off.
   * Then the browser's subscription is read again.
   */
  const lose = async (current: TraceReminder, error: unknown) => {
    if (error instanceof ReminderError && error.reason !== "other") {
      if (active) await subscription?.unsubscribe().catch(() => undefined);
      keep({ ...current, ended: current.ended || error.reason === "ended", active: null });
    }
    const held = await registration.current?.pushManager?.getSubscription().catch(() => null);
    if (held !== undefined) setSubscription(held);
  };

  /** On is a PUT after the browser's permission; off is a DELETE. */
  const switchTo = async (on: boolean, askPermission: () => Promise<void>) => {
    if (!experience) return;
    const memory = experience.memory;
    const current: TraceReminder = record ?? { memorySessionId: memory.memorySessionId, intervalMinutes: terms.intervalMinutes, ended: false, active: null };
    if (!on) {
      await switchOffTraceReminder(memory, active ? subscription : null);
      if (active) setSubscription(null);
      keep({ ...current, active: null });
      return;
    }
    try {
      if (current.ended || ended) throw new ReminderError(ENDED_MESSAGE, "ended");
      await askPermission();
      const latest = config ?? (await fetchPublicConfig());
      setConfig(latest);
      const ready = registration.current ?? (await serviceWorkerReady());
      // The push worker's own subscription is handed back to it before TRACE_B's replaces it.
      const made = await switchOnTraceReminder(ready, memory, latest.notification, current.intervalMinutes, (other) =>
        unsubscribe(other)
          .catch(() => dropExpired(other))
          .then(() => setWorkerExpiresAt(null)),
      );
      setSubscription(made.subscription);
      keep({ ...current, active: made.active });
    } catch (error) {
      await lose(current, error);
      throw error;
    }
  };

  /** A PATCH, while it is on. */
  const changeInterval = async (minutes: number) => {
    if (!experience || !record || !active) return;
    if (ended) throw new ReminderError(ENDED_MESSAGE, "ended");
    try {
      keep({ ...record, intervalMinutes: minutes, active: await changeTraceReminderInterval(experience.memory, active, minutes) });
    } catch (error) {
      await lose(record, error);
      throw error;
    }
  };

  /** TRACE_B ended the reminder when the participant arrived (a later PUT or PATCH answers 409). */
  const noteArrival = useCallback((memorySessionId: string) => {
    const ended = markTraceReminderEnded(memorySessionId);
    if (ended) setStored(ended);
  }, []);

  /** On withdrawing: TRACE_B's subscription went with the memory session. */
  const forget = () => keep(null);

  return { owned, reminder, switchTo, changeInterval, noteArrival, forget };
}
