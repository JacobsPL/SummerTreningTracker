package pl.jakub.tracker;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.*;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.*;

public class TrainingRepository {
    private static final int MAX_PHOTO_BYTES = 5 * 1024 * 1024;
    private static final Set<String> ALLOWED_PHOTO_TYPES = Set.of(
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif"
    );

    private final String jdbcUrl;
    private final LocalDate startDate;
    private final ZoneId zone;

    public TrainingRepository(String dbPath, LocalDate startDate, ZoneId zone) {
        this.jdbcUrl = "jdbc:sqlite:" + dbPath;
        this.startDate = startDate;
        this.zone = zone;
    }

    public void init() {
        try {
            Files.createDirectories(Path.of("data"));
        } catch (Exception e) {
            throw new RuntimeException("Nie można utworzyć katalogu data", e);
        }

        try (Connection connection = connect(); Statement statement = connection.createStatement()) {
            statement.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS people (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL
                    )
                    """);

            statement.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS training_entries (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        person_id INTEGER NOT NULL,
                        training_date TEXT NOT NULL,
                        done INTEGER NOT NULL,
                        photo_data BLOB,
                        photo_content_type TEXT,
                        UNIQUE(person_id, training_date),
                        FOREIGN KEY(person_id) REFERENCES people(id)
                    )
                    """);

            ensurePhotoColumns(connection);
            ensureDefaultPeople(connection);
        } catch (SQLException e) {
            throw new RuntimeException("Nie można zainicjalizować bazy danych", e);
        }
    }

    public StatusResponse getStatus() {
        LocalDate today = today();
        return new StatusResponse(startDate.toString(), today.toString(), daysSoFar(today));
    }

    public List<PersonSummaryResponse> getSummary() throws SQLException {
        LocalDate today = today();
        LocalDate yesterday = today.minusDays(1);
        int daysSoFar = daysSoFar(today);

        List<Person> people = getPeople();
        List<PersonSummaryResponse> result = new ArrayList<>();

        try (Connection connection = connect()) {
            for (Person person : people) {
                int completed = countCompleted(connection, person.id(), today);

                List<CurrentDayResponse> visibleDays = new ArrayList<>();
                addCurrentDayIfAllowed(connection, visibleDays, person.id(), today, "Dzisiaj");
                addCurrentDayIfAllowed(connection, visibleDays, person.id(), yesterday, "Wczoraj");

                result.add(new PersonSummaryResponse(
                        person.id(),
                        person.name(),
                        completed,
                        daysSoFar,
                        visibleDays
                ));
            }
        }

        return result;
    }

    public HistoryResponse getHistory() throws SQLException {
        LocalDate today = today();
        List<Person> people = getPeople();
        List<HistoryDayResponse> days = new ArrayList<>();

        if (today.isBefore(startDate)) {
            return new HistoryResponse(startDate.toString(), today.toString(), people, days);
        }

        Map<String, HistoryTrainingEntryResponse> entryMap = loadHistoryEntryMap(startDate, today);

        for (LocalDate date = startDate; !date.isAfter(today); date = date.plusDays(1)) {
            Map<Integer, HistoryTrainingEntryResponse> entries = new LinkedHashMap<>();
            for (Person person : people) {
                entries.put(person.id(), entryMap.getOrDefault(
                        key(person.id(), date),
                        new HistoryTrainingEntryResponse(false, false)
                ));
            }
            days.add(new HistoryDayResponse(date.toString(), entries));
        }

        Collections.reverse(days);
        return new HistoryResponse(startDate.toString(), today.toString(), people, days);
    }

    public void updateTraining(TrainingUpdateRequest request) throws SQLException {
        if (request == null) {
            throw new IllegalArgumentException("Brak danych wejściowych");
        }
        if (request.date == null || request.date.isBlank()) {
            throw new IllegalArgumentException("Brak daty treningu");
        }

        LocalDate date;
        try {
            date = LocalDate.parse(request.date);
        } catch (Exception e) {
            throw new IllegalArgumentException("Niepoprawny format daty. Użyj YYYY-MM-DD");
        }

        LocalDate today = today();
        LocalDate yesterday = today.minusDays(1);

        if (date.isBefore(startDate)) {
            throw new IllegalArgumentException("Nie można edytować dat sprzed startu planu");
        }
        if (!(date.equals(today) || date.equals(yesterday))) {
            throw new IllegalArgumentException("Można edytować tylko dzisiaj albo wczoraj");
        }
        if (!personExists(request.personId)) {
            throw new IllegalArgumentException("Nieznana osoba");
        }

        PhotoUpload photo = parsePhotoDataUrl(request.photoDataUrl);
        if (!request.done && photo != null) {
            throw new IllegalArgumentException("Zdjęcie można dodać tylko do wykonanego treningu");
        }

        try (Connection connection = connect(); PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO training_entries (person_id, training_date, done, photo_data, photo_content_type)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(person_id, training_date)
                DO UPDATE SET
                    done = excluded.done,
                    photo_data = CASE
                        WHEN excluded.done = 0 THEN NULL
                        WHEN excluded.photo_data IS NOT NULL THEN excluded.photo_data
                        ELSE training_entries.photo_data
                    END,
                    photo_content_type = CASE
                        WHEN excluded.done = 0 THEN NULL
                        WHEN excluded.photo_content_type IS NOT NULL THEN excluded.photo_content_type
                        ELSE training_entries.photo_content_type
                    END
                """)) {
            statement.setInt(1, request.personId);
            statement.setString(2, date.toString());
            statement.setInt(3, request.done ? 1 : 0);
            if (photo == null) {
                statement.setNull(4, Types.BLOB);
                statement.setNull(5, Types.VARCHAR);
            } else {
                statement.setBytes(4, photo.data());
                statement.setString(5, photo.contentType());
            }
            statement.executeUpdate();
        }
    }

    public TrainingPhoto getTrainingPhoto(int personId, String dateText) throws SQLException {
        if (dateText == null || dateText.isBlank()) {
            throw new IllegalArgumentException("Brak daty treningu");
        }

        LocalDate date;
        try {
            date = LocalDate.parse(dateText);
        } catch (Exception e) {
            throw new IllegalArgumentException("Niepoprawny format daty. Użyj YYYY-MM-DD");
        }

        LocalDate today = today();
        if (date.isBefore(startDate) || date.isAfter(today)) {
            throw new IllegalArgumentException("Niepoprawna data treningu");
        }
        if (!personExists(personId)) {
            throw new IllegalArgumentException("Nieznana osoba");
        }

        try (Connection connection = connect();
             PreparedStatement statement = connection.prepareStatement("""
                     SELECT photo_data, photo_content_type
                     FROM training_entries
                     WHERE person_id = ?
                       AND training_date = ?
                       AND done = 1
                       AND photo_data IS NOT NULL
                     """)) {
            statement.setInt(1, personId);
            statement.setString(2, date.toString());
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return null;
                }
                return new TrainingPhoto(
                        resultSet.getString("photo_content_type"),
                        resultSet.getBytes("photo_data")
                );
            }
        }
    }

    private Connection connect() throws SQLException {
        return DriverManager.getConnection(jdbcUrl);
    }

    private void ensurePhotoColumns(Connection connection) throws SQLException {
        Set<String> columns = new HashSet<>();
        try (Statement statement = connection.createStatement();
             ResultSet resultSet = statement.executeQuery("PRAGMA table_info(training_entries)")) {
            while (resultSet.next()) {
                columns.add(resultSet.getString("name"));
            }
        }

        try (Statement statement = connection.createStatement()) {
            if (!columns.contains("photo_data")) {
                statement.executeUpdate("ALTER TABLE training_entries ADD COLUMN photo_data BLOB");
            }
            if (!columns.contains("photo_content_type")) {
                statement.executeUpdate("ALTER TABLE training_entries ADD COLUMN photo_content_type TEXT");
            }
        }
    }

    private void ensureDefaultPeople(Connection connection) throws SQLException {
        List<Person> defaultPeople = List.of(
                new Person(1, "Julka"),
                new Person(2, "Wiktor"),
                new Person(3, "Jakub"),
                new Person(4, "Wojtek")
        );

        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO people (id, name)
                VALUES (?, ?)
                ON CONFLICT(id)
                DO UPDATE SET name = excluded.name
                """)) {
            for (Person person : defaultPeople) {
                statement.setInt(1, person.id());
                statement.setString(2, person.name());
                statement.executeUpdate();
            }
        }
    }

    private List<Person> getPeople() throws SQLException {
        List<Person> people = new ArrayList<>();
        try (Connection connection = connect();
             PreparedStatement statement = connection.prepareStatement("SELECT id, name FROM people ORDER BY id");
             ResultSet resultSet = statement.executeQuery()) {
            while (resultSet.next()) {
                people.add(new Person(resultSet.getInt("id"), resultSet.getString("name")));
            }
        }
        return people;
    }

    private boolean personExists(int personId) throws SQLException {
        try (Connection connection = connect();
             PreparedStatement statement = connection.prepareStatement("SELECT 1 FROM people WHERE id = ?")) {
            statement.setInt(1, personId);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next();
            }
        }
    }

    private int countCompleted(Connection connection, int personId, LocalDate today) throws SQLException {
        if (today.isBefore(startDate)) {
            return 0;
        }

        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT COUNT(*)
                FROM training_entries
                WHERE person_id = ?
                  AND done = 1
                  AND training_date BETWEEN ? AND ?
                """)) {
            statement.setInt(1, personId);
            statement.setString(2, startDate.toString());
            statement.setString(3, today.toString());
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() ? resultSet.getInt(1) : 0;
            }
        }
    }

    private void addCurrentDayIfAllowed(Connection connection, List<CurrentDayResponse> visibleDays, int personId, LocalDate date, String label) throws SQLException {
        if (date.isBefore(startDate)) {
            return;
        }
        CurrentEntryState state = getCurrentEntryState(connection, personId, date);
        visibleDays.add(new CurrentDayResponse(
                label,
                date.toString(),
                state.done(),
                true,
                state.hasPhoto()
        ));
    }

    private CurrentEntryState getCurrentEntryState(Connection connection, int personId, LocalDate date) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT done, photo_data IS NOT NULL AS has_photo
                FROM training_entries
                WHERE person_id = ? AND training_date = ?
                """)) {
            statement.setInt(1, personId);
            statement.setString(2, date.toString());
            try (ResultSet resultSet = statement.executeQuery()) {
                if (!resultSet.next()) {
                    return new CurrentEntryState(false, false);
                }
                boolean done = resultSet.getInt("done") == 1;
                boolean hasPhoto = done && resultSet.getInt("has_photo") == 1;
                return new CurrentEntryState(done, hasPhoto);
            }
        }
    }

    private Map<String, HistoryTrainingEntryResponse> loadHistoryEntryMap(LocalDate from, LocalDate to) throws SQLException {
        Map<String, HistoryTrainingEntryResponse> map = new HashMap<>();
        try (Connection connection = connect();
             PreparedStatement statement = connection.prepareStatement("""
                     SELECT person_id, training_date, done, photo_data IS NOT NULL AS has_photo
                     FROM training_entries
                     WHERE training_date BETWEEN ? AND ?
                     """)) {
            statement.setString(1, from.toString());
            statement.setString(2, to.toString());
            try (ResultSet resultSet = statement.executeQuery()) {
                while (resultSet.next()) {
                    int personId = resultSet.getInt("person_id");
                    LocalDate date = LocalDate.parse(resultSet.getString("training_date"));
                    boolean done = resultSet.getInt("done") == 1;
                    boolean hasPhoto = done && resultSet.getInt("has_photo") == 1;
                    map.put(key(personId, date), new HistoryTrainingEntryResponse(done, hasPhoto));
                }
            }
        }
        return map;
    }

    private PhotoUpload parsePhotoDataUrl(String dataUrl) {
        if (dataUrl == null || dataUrl.isBlank()) {
            return null;
        }
        if (!dataUrl.startsWith("data:")) {
            throw new IllegalArgumentException("Niepoprawny format zdjęcia");
        }

        int commaIndex = dataUrl.indexOf(',');
        if (commaIndex < 0) {
            throw new IllegalArgumentException("Niepoprawny format zdjęcia");
        }

        String metadata = dataUrl.substring("data:".length(), commaIndex);
        String encodedData = dataUrl.substring(commaIndex + 1);
        String[] metadataParts = metadata.split(";");
        String contentType = metadataParts.length > 0
                ? metadataParts[0].toLowerCase(Locale.ROOT)
                : "";

        if ("image/jpg".equals(contentType)) {
            contentType = "image/jpeg";
        }
        if (!ALLOWED_PHOTO_TYPES.contains(contentType)) {
            throw new IllegalArgumentException("Dozwolone są zdjęcia JPG, PNG, WEBP albo GIF");
        }

        boolean isBase64 = Arrays.stream(metadataParts).anyMatch(part -> "base64".equalsIgnoreCase(part));
        if (!isBase64) {
            throw new IllegalArgumentException("Zdjęcie musi być zakodowane jako base64");
        }

        byte[] data;
        try {
            data = Base64.getDecoder().decode(encodedData);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Nie można odczytać zdjęcia");
        }
        if (data.length == 0) {
            throw new IllegalArgumentException("Zdjęcie jest puste");
        }
        if (data.length > MAX_PHOTO_BYTES) {
            throw new IllegalArgumentException("Zdjęcie może mieć maksymalnie 5 MB");
        }

        return new PhotoUpload(contentType, data);
    }

    private String key(int personId, LocalDate date) {
        return personId + "|" + date;
    }

    private LocalDate today() {
        return LocalDate.now(zone);
    }

    private int daysSoFar(LocalDate today) {
        if (today.isBefore(startDate)) {
            return 0;
        }
        return (int) ChronoUnit.DAYS.between(startDate, today) + 1;
    }

    private record CurrentEntryState(boolean done, boolean hasPhoto) {
    }

    private record PhotoUpload(String contentType, byte[] data) {
    }
}
