import Foundation
import EventKit

@main struct LifeDashBridge {
    static func fetch(_ store: EKEventStore, predicate: NSPredicate) async -> [EKReminder] {
        await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) {
                continuation.resume(returning: $0 ?? [])
            }
        }
    }

    static func item(_ reminder: EKReminder, iso: ISO8601DateFormatter) -> [String: Any] {
        let due = reminder.dueDateComponents.flatMap { Calendar.current.date(from: $0) }
        var value: [String: Any] = [
            "id": reminder.calendarItemIdentifier,
            "title": reminder.title ?? "Untitled reminder",
            "due": due.map { iso.string(from: $0) } as Any? ?? NSNull(),
            "completed": reminder.isCompleted,
            "completedAt": reminder.completionDate.map { iso.string(from: $0) } as Any? ?? NSNull(),
            "listName": reminder.calendar.title
        ]
        if let rule = reminder.recurrenceRules?.first {
            value["recurring"] = true
            value["recurrenceInterval"] = rule.interval
            switch rule.frequency {
            case .daily: value["recurrenceFrequency"] = "daily"
            case .weekly: value["recurrenceFrequency"] = "weekly"
            case .monthly: value["recurrenceFrequency"] = "monthly"
            case .yearly: value["recurrenceFrequency"] = "yearly"
            @unknown default: value["recurrenceFrequency"] = "unknown"
            }
        }
        if let notes = reminder.notes?.trimmingCharacters(in: .whitespacesAndNewlines), !notes.isEmpty {
            value["notes"] = notes
        }
        return value
    }

    static func main() async {
        let store = EKEventStore()
        let arguments = Array(CommandLine.arguments.dropFirst())
        let target = arguments.first ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Developer/life-dashboard/.lifedash/apple-bridge.json").path
        var calendarAllowed = false
        var remindersAllowed = false
        do { calendarAllowed = try await store.requestFullAccessToEvents() } catch { }
        do { remindersAllowed = try await store.requestFullAccessToReminders() } catch { }
        let iso = ISO8601DateFormatter()
        let habitsListName = arguments.dropFirst().first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "Habits"
        while !Task.isCancelled {
            calendarAllowed = EKEventStore.authorizationStatus(for: .event) == .fullAccess
            remindersAllowed = EKEventStore.authorizationStatus(for: .reminder) == .fullAccess
            let now = Date()
            var snapshot: [String: Any] = ["version": 1, "capturedAt": iso.string(from: now), "permissions": ["calendar": calendarAllowed, "reminders": remindersAllowed]]
            if calendarAllowed {
                let start = Calendar.current.startOfDay(for: now)
                let end = Calendar.current.date(byAdding: .day, value: 8, to: start)!
                let events = store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil)).sorted { $0.startDate < $1.startDate }.map { event -> [String: Any] in
                    var item: [String: Any] = ["id": event.eventIdentifier ?? UUID().uuidString, "title": event.title ?? "Untitled event", "start": iso.string(from: event.startDate), "end": iso.string(from: event.endDate), "calendar": "personal", "calendarName": event.calendar.title, "calendarId": event.calendar.calendarIdentifier, "allDay": event.isAllDay]
                    if let location = event.location, !location.isEmpty { item["location"] = location }
                    return item
                }
                snapshot["calendar"] = ["events": events]
            }
            if remindersAllowed {
                let habitCalendars = store.calendars(for: .reminder).filter {
                    $0.title.caseInsensitiveCompare(habitsListName) == .orderedSame
                }
                let reminders = await fetch(store, predicate: store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil))
                let items = reminders
                    .filter { reminder in
                        !habitCalendars.contains { $0.calendarIdentifier == reminder.calendar.calendarIdentifier }
                    }
                    .map { item($0, iso: iso) }
                snapshot["reminders"] = ["items": items]
                let historyStart = Calendar.current.date(byAdding: .day, value: -35, to: now)!
                let habits = habitCalendars.isEmpty
                    ? []
                    : await fetch(store, predicate: store.predicateForReminders(in: habitCalendars))
                        .filter { reminder in
                            !reminder.isCompleted || (reminder.completionDate ?? .distantPast) >= historyStart
                        }
                        .map { item($0, iso: iso) }
                snapshot["habits"] = ["items": habits, "listName": habitsListName]
            }
            do {
                let data = try JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys])
                try data.write(to: URL(fileURLWithPath: target), options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target)
            } catch { fputs("LifeDash bridge could not write snapshot\n", stderr) }
            try? await Task.sleep(for: .seconds(30))
        }
    }
}
