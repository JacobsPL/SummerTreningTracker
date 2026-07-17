const peopleList = document.getElementById('peopleList');
const historyTableHead = document.querySelector('#historyTable thead');
const historyTableBody = document.querySelector('#historyTable tbody');
const historyCards = document.getElementById('historyCards');
const statusText = document.getElementById('statusText');
const message = document.getElementById('message');
const refreshButton = document.getElementById('refreshButton');
const photoModal = document.getElementById('photoModal');
const photoPreview = document.getElementById('photoPreview');
const photoCaption = document.getElementById('photoCaption');
const closePhotoButton = document.getElementById('closePhotoButton');

const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const TARGET_COMPRESSED_PHOTO_SIZE = 900 * 1024;
const COMPRESSED_PHOTO_TYPE = 'image/jpeg';
const COMPRESSION_PROFILES = [
    { maxSide: 1600, quality: 0.72 },
    { maxSide: 1400, quality: 0.64 },
    { maxSide: 1280, quality: 0.58 },
    { maxSide: 1024, quality: 0.52 }
];

function setMessage(text) {
    message.textContent = text || '';
}

async function apiGet(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error('Nie udało się pobrać danych');
    }
    return response.json();
}

async function apiPost(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        let errorMessage = 'Nie udało się zapisać danych';
        try {
            const error = await response.json();
            if (error.error) {
                errorMessage = error.error;
            }
        } catch (_) {
            // zostawiamy domyślny komunikat
        }
        throw new Error(errorMessage);
    }

    return response.json();
}

function validatePhoto(file) {
    if (!file) {
        throw new Error('Nie wybrano zdjęcia');
    }
    if (file.type && !file.type.startsWith('image/')) {
        throw new Error('Wybierz plik obrazu');
    }
    if (file.size > MAX_PHOTO_SIZE) {
        throw new Error('Zdjęcie może mieć maksymalnie 10 MB');
    }
}

async function readPhotoDataUrl(file) {
    validatePhoto(file);
    const compressedPhoto = await compressPhoto(file);
    if (compressedPhoto.size > MAX_PHOTO_SIZE) {
        throw new Error('Zdjęcie po kompresji nadal jest za duże');
    }
    return blobToDataUrl(compressedPhoto);
}

async function compressPhoto(file) {
    const image = await loadImage(file);
    let bestBlob = null;

    for (const profile of COMPRESSION_PROFILES) {
        const canvas = drawImageToCanvas(image, profile.maxSide);
        const blob = await canvasToBlob(canvas, COMPRESSED_PHOTO_TYPE, profile.quality);
        bestBlob = blob;
        if (blob.size <= TARGET_COMPRESSED_PHOTO_SIZE) {
            break;
        }
    }

    return bestBlob;
}

function loadImage(file) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);

        image.addEventListener('load', () => {
            URL.revokeObjectURL(url);
            resolve(image);
        }, { once: true });

        image.addEventListener('error', () => {
            URL.revokeObjectURL(url);
            reject(new Error('Nie można odczytać zdjęcia'));
        }, { once: true });

        image.src = url;
    });
}

function drawImageToCanvas(image, maxSide) {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return canvas;
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) {
                resolve(blob);
                return;
            }
            reject(new Error('Nie można skompresować zdjęcia'));
        }, type, quality);
    });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result));
        reader.addEventListener('error', () => reject(new Error('Nie można odczytać zdjęcia')));
        reader.readAsDataURL(blob);
    });
}

async function saveTraining(personId, date, done, file) {
    const payload = { personId, date, done };
    if (file) {
        payload.photoDataUrl = await readPhotoDataUrl(file);
    }
    await apiPost('/api/training', payload);
}

function formatDate(dateText) {
    const [year, month, day] = dateText.split('-');
    return `${day}.${month}.${year}`;
}

function renderStatus(status) {
    if (status.daysSoFar === 0) {
        statusText.textContent = `Start ${formatDate(status.startDate)} · dzisiaj ${formatDate(status.today)}`;
        return;
    }
    statusText.textContent = `Dzień ${status.daysSoFar} planu · start ${formatDate(status.startDate)}`;
}

function progressPercent(completed, daysSoFar) {
    if (!daysSoFar) {
        return 0;
    }
    return Math.min(100, Math.round((completed / daysSoFar) * 100));
}

function createCameraIcon() {
    const icon = document.createElement('span');
    icon.className = 'camera-icon';
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function renderSummary(summary) {
    peopleList.innerHTML = '';

    if (summary.length === 0) {
        peopleList.innerHTML = '<div class="empty-state">Brak osób do wyświetlenia.</div>';
        return;
    }

    for (const person of summary) {
        const card = document.createElement('article');
        card.className = 'person-card';
        const percent = progressPercent(person.completed, person.daysSoFar);

        const header = document.createElement('div');
        header.className = 'person-card-header';

        const name = document.createElement('h3');
        name.className = 'person-name';
        name.textContent = person.name;

        const score = document.createElement('div');
        score.className = 'person-score';
        score.innerHTML = `<strong>${person.completed}</strong><span>/${person.daysSoFar}</span>`;

        header.appendChild(name);
        header.appendChild(score);
        card.appendChild(header);

        const progress = document.createElement('div');
        progress.className = 'progress';
        progress.setAttribute('aria-label', `${person.name}: ${percent}% planu`);

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        progressBar.style.width = `${percent}%`;
        progress.appendChild(progressBar);
        card.appendChild(progress);

        if (!person.visibleDays || person.visibleDays.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'card-note';
            empty.textContent = 'Plan jeszcze nie wystartował.';
            card.appendChild(empty);
        } else {
            for (const day of person.visibleDays) {
                const row = document.createElement('div');
                row.className = 'day-row';
                row.classList.toggle('done-row', day.done);

                const label = document.createElement('div');
                label.className = 'day-info';

                const dayLabel = document.createElement('span');
                dayLabel.className = 'day-label';
                dayLabel.textContent = day.label;

                const dayDate = document.createElement('span');
                dayDate.className = 'day-date';
                dayDate.textContent = formatDate(day.date);

                label.appendChild(dayLabel);
                label.appendChild(dayDate);

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'status-checkbox';
                checkbox.checked = day.done;
                checkbox.disabled = !day.editable;
                checkbox.setAttribute('aria-label', `${person.name}: ${day.label.toLowerCase()} ${formatDate(day.date)}`);

                const statusToggle = document.createElement('label');
                statusToggle.className = 'status-toggle';
                statusToggle.title = day.done ? 'Oznacz jako niewykonane' : 'Oznacz jako wykonane';

                const statusControl = document.createElement('span');
                statusControl.className = 'status-control';
                statusControl.setAttribute('aria-hidden', 'true');

                statusToggle.appendChild(checkbox);
                statusToggle.appendChild(statusControl);

                const controls = document.createElement('div');
                controls.className = 'day-controls';

                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = 'image/*';
                fileInput.className = 'visually-hidden';
                fileInput.tabIndex = -1;
                fileInput.setAttribute('aria-hidden', 'true');

                const photoButton = document.createElement('button');
                photoButton.type = 'button';
                photoButton.className = 'photo-button icon-button';
                photoButton.appendChild(createCameraIcon());

                function updatePhotoButton() {
                    const labelText = day.hasPhoto ? 'Zmień zdjęcie' : 'Dodaj zdjęcie';
                    photoButton.classList.toggle('has-photo', day.hasPhoto);
                    photoButton.setAttribute('aria-label', `${labelText}: ${person.name}, ${day.label.toLowerCase()}`);
                    photoButton.title = labelText;
                    photoButton.disabled = checkbox.disabled;
                    statusToggle.title = checkbox.checked ? 'Oznacz jako niewykonane' : 'Oznacz jako wykonane';
                    row.classList.toggle('done-row', checkbox.checked);
                }

                updatePhotoButton();

                photoButton.addEventListener('click', () => {
                    fileInput.click();
                });

                fileInput.addEventListener('change', async () => {
                    const file = fileInput.files[0];
                    if (!file) {
                        return;
                    }

                    const wasChecked = checkbox.checked;
                    checkbox.checked = true;
                    updatePhotoButton();

                    try {
                        setMessage('');
                        await saveTraining(person.personId, day.date, true, file);
                        fileInput.value = '';
                        await loadData();
                    } catch (error) {
                        checkbox.checked = wasChecked;
                        fileInput.value = '';
                        updatePhotoButton();
                        setMessage(error.message);
                    }
                });

                checkbox.addEventListener('change', async () => {
                    const checked = checkbox.checked;
                    try {
                        setMessage('');
                        updatePhotoButton();
                        await saveTraining(person.personId, day.date, checked);
                        await loadData();
                    } catch (error) {
                        checkbox.checked = !checked;
                        updatePhotoButton();
                        setMessage(error.message);
                    }
                });

                row.appendChild(label);
                controls.appendChild(fileInput);
                controls.appendChild(photoButton);
                controls.appendChild(statusToggle);
                row.appendChild(controls);
                card.appendChild(row);
            }
        }

        peopleList.appendChild(card);
    }
}

function renderHistory(history) {
    historyTableHead.innerHTML = '';
    historyTableBody.innerHTML = '';
    historyCards.innerHTML = '';

    const headerRow = document.createElement('tr');
    const dateHeader = document.createElement('th');
    dateHeader.scope = 'col';
    dateHeader.textContent = 'Data';
    headerRow.appendChild(dateHeader);

    for (const person of history.people) {
        const header = document.createElement('th');
        header.scope = 'col';
        header.textContent = person.name;
        headerRow.appendChild(header);
    }
    historyTableHead.appendChild(headerRow);

    if (!history.days || history.days.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = history.people.length + 1;
        cell.textContent = 'Historia pojawi się od dnia startu planu.';
        row.appendChild(cell);
        historyTableBody.appendChild(row);
        return;
    }

    for (const day of history.days) {
        const row = document.createElement('tr');
        const dateCell = document.createElement('td');
        dateCell.textContent = formatDate(day.date);
        row.appendChild(dateCell);

        const historyCard = document.createElement('article');
        historyCard.className = 'history-card';

        const historyDate = document.createElement('div');
        historyDate.className = 'history-card-date';
        historyDate.textContent = formatDate(day.date);
        historyCard.appendChild(historyDate);

        const historyList = document.createElement('div');
        historyList.className = 'history-card-list';

        for (const person of history.people) {
            const cell = document.createElement('td');
            const entry = normalizeHistoryEntry(day.entries[String(person.id)]);
            cell.dataset.state = entry.done ? 'done' : 'missed';

            const mobileRow = document.createElement('div');
            mobileRow.className = 'history-card-row';

            const mobileName = document.createElement('span');
            mobileName.className = 'history-card-name';
            mobileName.textContent = person.name;

            const mobileStatus = document.createElement('span');
            mobileStatus.className = entry.done ? 'history-card-status done' : 'history-card-status missed';

            mobileRow.appendChild(mobileName);

            if (!entry.done) {
                const empty = document.createElement('span');
                empty.className = 'history-empty';
                empty.textContent = '—';
                empty.setAttribute('aria-label', 'Brak treningu');
                cell.appendChild(empty);

                mobileStatus.textContent = '—';
            } else {
                cell.className = 'done';
                mobileStatus.textContent = '✓';

                if (entry.hasPhoto) {
                    const photoButton = document.createElement('button');
                    photoButton.type = 'button';
                    photoButton.className = 'history-photo-button icon-button';
                    photoButton.appendChild(createCameraIcon());
                    photoButton.setAttribute('aria-label', `Zdjęcie treningu: ${person.name}, ${formatDate(day.date)}`);
                    photoButton.title = 'Zobacz zdjęcie';
                    photoButton.addEventListener('click', () => openPhoto(person.id, day.date, person.name, entry.photoVersion));
                    cell.appendChild(photoButton);
                    mobileStatus.classList.add('has-photo');
                    mobileStatus.textContent = '';
                    mobileStatus.appendChild(createCameraIcon());
                    mobileStatus.setAttribute('aria-label', `Trening wykonany, zdjęcie dodane: ${person.name}, ${formatDate(day.date)}`);
                    mobileStatus.addEventListener('click', () => openPhoto(person.id, day.date, person.name, entry.photoVersion));
                    mobileStatus.setAttribute('role', 'button');
                    mobileStatus.tabIndex = 0;
                    mobileStatus.title = 'Zobacz zdjęcie';
                    mobileStatus.addEventListener('keydown', event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openPhoto(person.id, day.date, person.name, entry.photoVersion);
                        }
                    });
                } else {
                    const marker = document.createElement('span');
                    marker.className = 'history-check';
                    marker.textContent = '✓';
                    marker.setAttribute('aria-label', 'Trening wykonany');
                    cell.appendChild(marker);
                }
            }
            mobileRow.appendChild(mobileStatus);
            historyList.appendChild(mobileRow);
            row.appendChild(cell);
        }

        historyTableBody.appendChild(row);
        historyCard.appendChild(historyList);
        historyCards.appendChild(historyCard);
    }
}

function normalizeHistoryEntry(entry) {
    if (typeof entry === 'boolean') {
        return { done: entry, hasPhoto: false };
    }
    return {
        done: entry && entry.done === true,
        hasPhoto: entry && entry.hasPhoto === true,
        photoVersion: entry ? entry.photoVersion : null
    };
}

function openPhoto(personId, date, personName, photoVersion) {
    photoCaption.textContent = `${personName} · ${formatDate(date)}`;
    photoPreview.alt = `Zdjęcie treningu: ${personName}, ${formatDate(date)}`;
    const params = new URLSearchParams({
        personId,
        date
    });
    if (photoVersion) {
        params.set('v', photoVersion);
    }
    photoPreview.src = `/api/training/photo?${params.toString()}`;
    photoModal.hidden = false;
    document.body.classList.add('modal-open');
    closePhotoButton.focus();
}

function closePhoto() {
    photoModal.hidden = true;
    photoPreview.removeAttribute('src');
    photoPreview.removeAttribute('alt');
    document.body.classList.remove('modal-open');
}

async function loadData() {
    try {
        setMessage('');
        const [status, summary, history] = await Promise.all([
            apiGet('/api/status'),
            apiGet('/api/summary'),
            apiGet('/api/history')
        ]);

        renderStatus(status);
        renderSummary(summary);
        renderHistory(history);
    } catch (error) {
        setMessage(error.message);
    }
}

photoModal.addEventListener('click', event => {
    if (event.target.dataset.closePhoto !== undefined) {
        closePhoto();
    }
});

closePhotoButton.addEventListener('click', closePhoto);

photoPreview.addEventListener('error', () => {
    if (!photoModal.hidden) {
        closePhoto();
        setMessage('Nie udało się wyświetlić zdjęcia');
    }
});

document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !photoModal.hidden) {
        closePhoto();
    }
});

for (const button of document.querySelectorAll('.tab-button')) {
    button.setAttribute('aria-selected', button.classList.contains('active') ? 'true' : 'false');
    button.addEventListener('click', () => {
        document.querySelectorAll('.tab-button').forEach(item => {
            item.classList.remove('active');
            item.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.tab-panel').forEach(item => item.classList.remove('active'));

        button.classList.add('active');
        button.setAttribute('aria-selected', 'true');
        document.getElementById(button.dataset.tab).classList.add('active');
    });
}

refreshButton.addEventListener('click', loadData);
loadData();
