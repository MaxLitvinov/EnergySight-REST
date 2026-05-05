# EnergySight REST API

> Практична робота №4 — Розробка REST API для енергетичних даних  
> Node.js · без npm-залежностей · JSON API · Практичне заняття №10–12

---

## Зміст

- [Опис](#опис)
- [Структура проєкту](#структура-проєкту)
- [Швидкий старт](#швидкий-старт)
- [API Reference](#api-reference)
- [Приклади запитів](#приклади-запитів)
- [Схема даних](#схема-даних)
- [Тестування](#тестування)

---

## Опис

REST API для моніторингу параметрів енергетичних об'єктів (ТЕС, ГЕС, СЕС, ВЕС).  
Сервер надає JSON-відповіді з параметрами: потужність, напруга, струм, частота, завантаженість.

**Технологічний стек:**
- Node.js 18+ (вбудований модуль `http`)
- Без npm-залежностей
- In-memory storage (дані зберігаються в RAM)
- CORS увімкнено для всіх origin

---

## Структура проєкту

```
pr4/
├── server/
│   └── server.js        # REST API сервер (порт 3002)
├── client/
│   └── index.html       # Веб-клієнт (SPA)
└── README.md
```

---

## Швидкий старт

```bash
# Клонувати репозиторій
git clone https://github.com/your-username/energysight-api.git
cd energysight-api

# Запустити сервер (Node.js 18+ required)
node server/server.js

# Сервер запущено на http://localhost:3002
# Відкрити клієнт: відкрийте client/index.html у браузері
```

> **Примітка:** npm-пакети не потрібні. Сервер використовує лише вбудовані модулі Node.js.

---

## API Reference

**Base URL:** `http://localhost:3002/api`

### Об'єкти

| Метод | Ендпоінт | Опис |
|-------|----------|------|
| `GET` | `/objects` | Список усіх об'єктів |
| `GET` | `/objects/:id` | Один об'єкт + останнє вимірювання |

### Параметри

| Метод | Ендпоінт | Опис |
|-------|----------|------|
| `GET` | `/objects/:id/parameters` | Список вимірювань |
| `GET` | `/objects/:id/parameters?limit=N` | З лімітом (макс. 500) |
| `GET` | `/objects/:id/parameters?from=ISO&to=ISO` | Фільтр за діапазоном дат |
| `POST` | `/objects/:id/parameters` | Додати нове вимірювання |

### Аналітика

| Метод | Ендпоінт | Опис |
|-------|----------|------|
| `GET` | `/objects/:id/history` | Остані 60 записів + статистика (avg/max/min) |
| `DELETE` | `/objects/:id/history` | Очистити всю історію |
| `GET` | `/objects/:id/export.csv` | Завантажити CSV-дамп |

### Службові

| Метод | Ендпоінт | Опис |
|-------|----------|------|
| `GET` | `/health` | Стан сервера, uptime |

---

## Приклади запитів

### GET /api/health

```bash
curl http://localhost:3002/api/health
```

```json
{
  "status": "ok",
  "uptime": 42,
  "objects": 4,
  "apiVersion": "1.0",
  "timestamp": "2024-05-10T14:23:00.000Z"
}
```

---

### GET /api/objects

```bash
curl http://localhost:3002/api/objects
```

```json
{
  "data": [
    {
      "id": 1,
      "name": "ТЕС «Придніпровська»",
      "type": "thermal",
      "location": "м. Дніпро",
      "nominalPowerMW": 900,
      "voltageKV": 220,
      "status": "operating",
      "paramCount": 30
    }
  ],
  "total": 4,
  "apiVersion": "1.0",
  "timestamp": "2024-05-10T14:23:00.000Z"
}
```

---

### GET /api/objects/:id/parameters

```bash
curl "http://localhost:3002/api/objects/1/parameters?limit=5"
```

```json
{
  "data": [
    {
      "id": 1,
      "objectId": 1,
      "timestamp": "2024-05-10T14:00:00.000Z",
      "powerMW": 612.5,
      "voltageKV": 218.3,
      "currentKA": 1.6123,
      "frequencyHz": 49.998,
      "loadPercent": 68.1
    }
  ],
  "total": 5
}
```

---

### POST /api/objects/:id/parameters

```bash
curl -X POST http://localhost:3002/api/objects/1/parameters \
  -H "Content-Type: application/json" \
  -d '{
    "powerMW": 612.5,
    "voltageKV": 218.3,
    "frequencyHz": 50.01,
    "loadPercent": 68.1
  }'
```

**Відповідь `201 Created`:**

```json
{
  "data": {
    "id": 31,
    "objectId": 1,
    "timestamp": "2024-05-10T14:25:00.000Z",
    "powerMW": 612.5,
    "voltageKV": 218.3,
    "currentKA": null,
    "frequencyHz": 50.01,
    "loadPercent": 68.1
  },
  "apiVersion": "1.0",
  "timestamp": "2024-05-10T14:25:00.000Z"
}
```

---

### GET /api/objects/:id/history

```bash
curl http://localhost:3002/api/objects/1/history
```

```json
{
  "data": [ /* останні 60 записів */ ],
  "stats": {
    "count": 30,
    "avgPowerMW": 601.34,
    "maxPowerMW": 789.21,
    "minPowerMW": 498.10
  },
  "total": 30
}
```

---

### GET /api/objects/:id/export.csv

```bash
curl "http://localhost:3002/api/objects/1/export.csv" -o data.csv
```

Завантажує CSV-файл з BOM (UTF-8) для коректного відкриття в Excel.

---

## Схема даних

### Object

```typescript
{
  id:              number       // Унікальний ідентифікатор
  name:            string       // Назва об'єкта
  type:            'thermal' | 'hydro' | 'solar' | 'wind'
  location:        string       // Місцезнаходження
  nominalPowerMW:  number       // Номінальна потужність (МВт)
  voltageKV:       number       // Номінальна напруга (кВ)
  commissionYear:  number       // Рік введення в експлуатацію
  status:          'operating' | 'maintenance' | 'offline'
}
```

### Parameter Record

```typescript
{
  id:           number    // Auto-increment ID
  objectId:     number    // Посилання на об'єкт
  timestamp:    string    // ISO 8601 datetime
  powerMW:      number    // Активна потужність (МВт) — обов'язкове
  voltageKV:    number | null  // Напруга (кВ)
  currentKA:    number | null  // Струм (кА)
  frequencyHz:  number | null  // Частота (Гц), діапазон [45, 55]
  loadPercent:  number | null  // Завантаженість (%), діапазон [0, 110]
}
```

---

## Коди відповідей

| Код | Опис |
|-----|------|
| `200 OK` | Успішний GET |
| `201 Created` | Запис створено (POST) |
| `204 No Content` | CORS preflight |
| `400 Bad Request` | Невалідний JSON або параметр |
| `404 Not Found` | Об'єкт не знайдено |
| `422 Unprocessable Entity` | Помилка валідації даних |
| `500 Internal Server Error` | Внутрішня помилка сервера |

---

## Тестування

Ручне тестування виконується за допомогою `curl` або вбудованого веб-клієнта (`client/index.html`).

```bash
# Перевірка стану сервера
curl http://localhost:3002/api/health

# Список об'єктів
curl http://localhost:3002/api/objects

# Параметри об'єкта з лімітом
curl "http://localhost:3002/api/objects/1/parameters?limit=10"

# Додавання запису
curl -X POST http://localhost:3002/api/objects/2/parameters \
  -H "Content-Type: application/json" \
  -d '{"powerMW": 420.0, "voltageKV": 152.5, "frequencyHz": 49.99, "loadPercent": 64.5}'

# Тест помилки 404
curl http://localhost:3002/api/objects/999

# Тест помилки 422
curl -X POST http://localhost:3002/api/objects/1/parameters \
  -H "Content-Type: application/json" \
  -d '{"voltageKV": 220}'

# Завантаження CSV
curl "http://localhost:3002/api/objects/1/export.csv" -o result.csv
```

---

## Автор
Літвінов Максим 
