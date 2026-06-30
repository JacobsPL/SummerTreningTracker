const peopleList = document.getElementById('peopleList');
const historyTableHead = document.querySelector('#historyTable thead');
const historyTableBody = document.querySelector('#historyTable tbody');
const statusText = document.getElementById('statusText');
const message = document.getElementById('message');
const refreshButton = document.getElementById('refreshButton');
const photoModal = document.getElementById('photoModal');
const photoPreview = document.getElementById('photoPreview');
const photoCaption = document.getElementById('photoCaption');
const closePhotoButton = document.getElementById('closePhotoButton');

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

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
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
        throw new Error('Dozwolone są zdjęcia JPG, PNG, WEBP albo GIF');
    }
    if (file.size > MAX_PHOTO_SIZE) {
        throw new Error('Zdjęcie może mieć maksymalnie 5 MB');
    }
}

function readPhotoDataUrl(file) {
    validatePhoto(file);

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result));
        reader.addEventListener('error', () => reject(new Error('Nie można odczytać zdjęcia')));
        reader.readAsDataURL(file);
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
        statusText.textContent = `Plan startuje ${formatDate(status.startDate)}. Dzisiaj: ${formatDate(status.today)}.`;
        return;
    }
    statusText.textContent = `Dzień ${status.daysSoFar} planu. Start: ${formatDate(status.startDate)}.`;
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

        const top = document.createElement('div');
        top.className = 'person-top';
        top.innerHTML = `
            <div class="person-name">${person.name}</div>
            <div class="counter">${person.completed}/${person.daysSoFar}</div>
        `;
        card.appendChild(top);

        if (!person.visibleDays || person.visibleDays.length === 0) {
            const empty = document.createElement('p');
            empty.textContent = 'Checkboxy pojawią się od dnia startu planu.';
            card.appendChild(empty);
        } else {
            for (const day of person.visibleDays) {
                const row = document.createElement('div');
                row.className = 'day-row';

                const label = document.createElement('div');
                label.innerHTML = `
                    <span class="day-label">${day.label}</span>
                    <span class="day-date">${formatDate(day.date)}</span>
                `;

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = day.done;
                checkbox.disabled = !day.editable;

                const controls = document.createElement('div');
                controls.className = 'day-controls';

                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.accept = 'image/*';
                fileInput.className = 'visually-hidden';

                const photoButton = document.createElement('button');
                photoButton.type = 'button';
                photoButton.className = 'photo-button';

                function updatePhotoButton() {
                    photoButton.textContent = day.hasPhoto ? 'Zmień zdjęcie' : 'Dodaj zdjęcie';
                    photoButton.disabled = checkbox.disabled;
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
                controls.appendChild(checkbox);
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

    const headerRow = document.createElement('tr');
    headerRow.innerHTML = '<th>Data</th>' + history.people.map(person => `<th>${person.name}</th>`).join('');
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

        for (const person of history.people) {
            const cell = document.createElement('td');
            const entry = normalizeHistoryEntry(day.entries[String(person.id)]);

            if (!entry.done) {
                cell.textContent = '—';
            } else {
                const marker = document.createElement('span');
                marker.className = 'done-marker';
                marker.textContent = '✓';
                cell.appendChild(marker);
                cell.className = 'done';

                if (entry.hasPhoto) {
                    const photoButton = document.createElement('button');
                    photoButton.type = 'button';
                    photoButton.className = 'photo-view-button';
                    photoButton.textContent = 'Zobacz zdjęcie';
                    photoButton.addEventListener('click', () => openPhoto(person.id, day.date, person.name));
                    cell.appendChild(photoButton);
                }
            }
            row.appendChild(cell);
        }

        historyTableBody.appendChild(row);
    }
}

function normalizeHistoryEntry(entry) {
    if (typeof entry === 'boolean') {
        return { done: entry, hasPhoto: false };
    }
    return {
        done: entry && entry.done === true,
        hasPhoto: entry && entry.hasPhoto === true
    };
}

function openPhoto(personId, date, personName) {
    photoCaption.textContent = `${personName} · ${formatDate(date)}`;
    photoPreview.alt = `Zdjęcie treningu: ${personName}, ${formatDate(date)}`;
    photoPreview.src = `/api/training/photo?personId=${encodeURIComponent(personId)}&date=${encodeURIComponent(date)}&v=${Date.now()}`;
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
    button.addEventListener('click', () => {
        document.querySelectorAll('.tab-button').forEach(item => item.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(item => item.classList.remove('active'));

        button.classList.add('active');
        document.getElementById(button.dataset.tab).classList.add('active');
    });
}

refreshButton.addEventListener('click', loadData);
loadData();
