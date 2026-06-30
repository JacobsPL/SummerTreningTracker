package pl.jakub.tracker;

import java.util.Map;

public record HistoryDayResponse(String date, Map<Integer, HistoryTrainingEntryResponse> entries) {
}
