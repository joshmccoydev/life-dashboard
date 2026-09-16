import type { ReminderState } from "@/domains/models";
import { localDateKey } from "./time";

const paymentsList = "payments";

export function isPaymentReminder(reminder: ReminderState["items"][number]) {
  return (
    reminder.dashboardRole === "payment" ||
    reminder.listName?.trim().toLocaleLowerCase() === paymentsList
  );
}

export function isOrdinaryReminder(reminder: ReminderState["items"][number]) {
  return reminder.dashboardRole
    ? reminder.dashboardRole === "ordinary"
    : !isPaymentReminder(reminder);
}

export function upcomingPayments(
  reminders: ReminderState["items"],
  now: Date,
  timezone: string,
) {
  const today = localDateKey(now, timezone);
  return reminders
    .filter(
      (reminder) =>
        !reminder.completed &&
        isPaymentReminder(reminder) &&
        reminder.due &&
        localDateKey(new Date(reminder.due), timezone) >= today,
    )
    .sort((a, b) => Date.parse(a.due!) - Date.parse(b.due!));
}
