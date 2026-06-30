package pl.jakub.tracker;

public record CurrentDayResponse(String label, String date, boolean done, boolean editable, boolean hasPhoto) {
}
