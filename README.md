# int_parser

Микросервис парсинга объявлений (Avito/и др.) для интеграции с AmoCRM.  
Получает задачи через HTTP, парсит страницу в браузере (Puppeteer) и отправляет результат на вебхук основного сервиса.

---

## Что делает проект

- Принимает запрос `POST /parser/enqueue` с `leadId`, `fields[]`, `url`, `webhookUrl`.
- Кладёт задачу в очередь (Bull + Redis).
- В воркере открывает страницу через Puppeteer, извлекает заданные поля.
- Отправляет результат на указанный `webhookUrl` в виде JSON.

> ⚠️ Не хранит и не использует AmoCRM токены — только парсинг и возврат данных.

---

## Технологии

- **NestJS 10** — каркас сервиса (контроллеры, DI).
- **Bull (bull + @nestjs/bull)** — очередь задач, ретраи, backoff.
- **Redis** — брокер для очереди.
- **Puppeteer** — headless Chrome для рендера и парсинга.
- **class-validator / class-transformer** — валидация DTO.
- **@nestjs/config** — конфигурация через ENV.
- **axios** — отправка результатов на вебхук.

---

## Архитектура (коротко)

- `ParserController` — эндпоинт `/parser/enqueue`, постановка задач.
- `ParserService` — подготовка payload и добавление job в очередь.
- `ParseProcessor` — обработчик очереди: открывает страницу, извлекает поля, шлёт вебхук.
- `ResultWebhookService` — HTTP-клиент для отправки результата.
- `PARSE_QUEUE = 'parse.requests'` — имя очереди.

Поддерживаемые поля (на сейчас):
- `CONTACT_PERSON_NAME`(Авито)
- `ADDRESS`(Авито)

> Неподдерживаемые поля не роняют задачу: вернётся `value: null` и будет предупреждение в логах.

---

## API

### `POST /parser/enqueue`

**Body (JSON):**
```json
{
  "leadId": "T200",
  "fields": ["CONTACT_PERSON_NAME", "ADDRESS"],
  "url": "https://www.avito.ru/.../...",
  "webhookUrl": "https://your.main.service/internal/parser/result"
}
