package pl.jakub.tracker;

import io.javalin.Javalin;
import io.javalin.http.HttpStatus;
import io.javalin.http.staticfiles.Location;

import java.io.ByteArrayInputStream;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;

public class Main {
    private static final long MAX_REQUEST_SIZE_BYTES = 15L * 1024 * 1024;
    private static final ZoneId ZONE = ZoneId.of("Europe/Warsaw");
    private static final LocalDate START_DATE = LocalDate.parse(
            System.getenv().getOrDefault("START_DATE", "2026-07-01")
    );

    public static void main(String[] args) {
        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "7070"));

        TrainingRepository repository = new TrainingRepository("data/training.db", START_DATE, ZONE);
        repository.init();

        Javalin app = Javalin.create(config -> {
            config.http.maxRequestSize = MAX_REQUEST_SIZE_BYTES;
            config.staticFiles.add(staticFiles -> {
                staticFiles.hostedPath = "/";
                staticFiles.directory = "/public";
                staticFiles.location = Location.CLASSPATH;
            });
        });

        app.exception(IllegalArgumentException.class, (e, ctx) ->
                ctx.status(HttpStatus.BAD_REQUEST).json(Map.of("error", e.getMessage()))
        );

        app.exception(Exception.class, (e, ctx) -> {
            e.printStackTrace();
            ctx.status(HttpStatus.INTERNAL_SERVER_ERROR).json(Map.of("error", "Błąd serwera"));
        });

        app.get("/api/status", ctx -> ctx.json(repository.getStatus()));
        app.get("/api/summary", ctx -> ctx.json(repository.getSummary()));
        app.get("/api/history", ctx -> ctx.json(repository.getHistory()));
        app.get("/api/training/photo", ctx -> {
            int personId;
            try {
                personId = Integer.parseInt(ctx.queryParam("personId"));
            } catch (Exception e) {
                throw new IllegalArgumentException("Niepoprawna osoba");
            }

            TrainingPhoto photo = repository.getTrainingPhoto(personId, ctx.queryParam("date"));
            if (photo == null) {
                ctx.status(HttpStatus.NOT_FOUND).json(Map.of("error", "Brak zdjęcia"));
                return;
            }

            ctx.contentType(photo.contentType());
            if (photo.photoVersion() != null) {
                ctx.header("Cache-Control", "public, max-age=31536000, immutable");
                ctx.header("ETag", "\"" + photo.photoVersion() + "\"");
            } else {
                ctx.header("Cache-Control", "private, max-age=86400");
            }
            ctx.result(new ByteArrayInputStream(photo.data()));
        });

        app.post("/api/training", ctx -> {
            TrainingUpdateRequest request = ctx.bodyAsClass(TrainingUpdateRequest.class);
            repository.updateTraining(request);
            ctx.json(Map.of("status", "ok"));
        });

        app.start("0.0.0.0", port);
        System.out.println("Training Tracker działa na porcie " + port);
        System.out.println("Start liczenia dni: " + START_DATE);
    }
}
