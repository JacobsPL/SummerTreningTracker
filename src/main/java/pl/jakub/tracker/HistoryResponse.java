package pl.jakub.tracker;

import java.util.List;

public record HistoryResponse(
        String startDate,
        String today,
        List<Person> people,
        List<HistoryDayResponse> days
) {
}
