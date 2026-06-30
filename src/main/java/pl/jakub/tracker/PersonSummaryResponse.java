package pl.jakub.tracker;

import java.util.List;

public record PersonSummaryResponse(
        int personId,
        String name,
        int completed,
        int daysSoFar,
        List<CurrentDayResponse> visibleDays
) {
}
