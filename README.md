# Training Tracker

Bardzo prosta aplikacja webowa do śledzenia treningów 4 zawodników.

Stos:

- Java 17
- Javalin
- SQLite
- HTML + CSS + JavaScript

## Funkcje

- Zawodnicy startowi: `Julka`, `Wiktor`, `Jakub`, `Wojtek`.
- Licznik przy osobie: `liczba wykonanych treningów / liczba dni od startu`.
- Start liczenia dni: domyślnie `2026-07-01`.
- Przy osobie widoczne są checkboxy dla dzisiaj i wczoraj.
- Do wykonanego treningu można dodać zdjęcie. Plik wejściowy może mieć do 10 MB, a przeglądarka kompresuje go przed zapisem do bazy.
- Pełna historia jest w osobnej zakładce.
- Backend blokuje edycję starszych dni i przyszłości.
- Dane zapisują się w SQLite: `data/training.db`.

## Uruchomienie lokalnie

W katalogu projektu:

```bash
mvn package
java -jar target/training-tracker-1.0.0.jar
```

Następnie wejdź w przeglądarce:

```text
http://localhost:7070
```

## Uruchomienie na Raspberry Pi

Zainstaluj Javę i Mavena:

```bash
sudo apt update
sudo apt install openjdk-17-jdk maven
```

Skopiuj projekt na Raspberry Pi, przejdź do katalogu projektu i wykonaj:

```bash
mvn package
java -jar target/training-tracker-1.0.0.jar
```

W sieci lokalnej aplikacja będzie dostępna pod adresem:

```text
http://ADRES_IP_RASPBERRY_PI:7070
```

Adres IP Raspberry Pi sprawdzisz np. tak:

```bash
hostname -I
```

## Zmiana portu

```bash
PORT=8080 java -jar target/training-tracker-1.0.0.jar
```

## Zmiana daty startu

```bash
START_DATE=2026-07-01 java -jar target/training-tracker-1.0.0.jar
```

## Zawodnicy

Domyślni zawodnicy są ustawieni w pliku:

```text
src/main/java/pl/jakub/tracker/TrainingRepository.java
```

Aktualna lista:

```text
1. Julka
2. Wiktor
3. Jakub
4. Wojtek
```

Przy starcie aplikacja wykonuje `INSERT ... ON CONFLICT`, więc jeśli baza `data/training.db` już istnieje, zawodnicy o ID 1-4 zostaną dopisani albo zaktualizowani automatycznie po restarcie aplikacji.

Jeżeli chcesz wyczyścić całą historię i zacząć od zera:

```bash
rm data/training.db
java -jar target/training-tracker-1.0.0.jar
```

Uwaga: usunięcie `training.db` kasuje historię treningów.
