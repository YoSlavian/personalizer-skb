# Бот и Mini App на Render.com (бесплатно)

Что получится: `https://<имя>.onrender.com/miniapp` с HTTPS, бот в Telegram с кнопкой «Приложение»,
база PostgreSQL с синтетическими демо-данными. Всё описано в `render.yaml` в корне репозитория.

Ограничения бесплатного тарифа:
- сервис засыпает через 15 минут без запросов; первый ответ после сна — до минуты (бот работает через webhook, поэтому сообщение его будит);
- бесплатная PostgreSQL удаляется через 30 дней — до финала 28.10 хватает;
- демо-режим включён: любой, у кого есть ссылка, может войти под синтетической демо-ролью. Реальных данных в системе нет.

## 1. Код на GitHub

1. Войдите на github.com → **New repository** → имя `personalizer-skb`, **Private** → **Create repository**.
2. На странице репозитория: **uploading an existing file**.
3. Первая загрузка: перетащите папку `backend` из `upload_for_github` → **Commit changes**.
   (GitHub принимает до 100 файлов за раз, поэтому загрузка в два захода.)
4. Снова **Add file → Upload files**: перетащите всё остальное из `upload_for_github` —
   папки `frontend`, `docs`, `infra`, `scripts` и файлы `Dockerfile`, `render.yaml`, `docker-compose.yml`,
   `README.md`, `.gitignore`, `.gitattributes`, `.dockerignore`, `.env.example` → **Commit changes**.
5. Проверьте, что в корне репозитория видны `Dockerfile` и `render.yaml`.

В `upload_for_github` нет токена бота, локальной базы, `node_modules` и материалов кейса — только код.

## 2. Сервис на Render

1. Войдите на render.com через GitHub и разрешите доступ к репозиторию `personalizer-skb`.
2. **New → Blueprint** → выберите репозиторий. Render прочитает `render.yaml` и покажет веб-сервис и базу.
3. В поле `TELEGRAM_BOT_TOKEN` вставьте токен бота от @BotFather (он лежит в локальном `.env`).
4. **Apply** (или **Deploy Blueprint**). Первая сборка — 5–10 минут.
5. Когда статус станет **Live**, откройте `https://<имя>.onrender.com/api/health`. Должно быть
   `"status": "ok"`, `"database": true`, `"telegram": {"mode": "webhook", "running": true, …}`.
   Если имя `personalizer-skb` занято, Render добавит суффикс — дальше используйте фактический адрес.

Адрес для webhook и Mini App сервис берёт сам из `RENDER_EXTERNAL_URL`, секрет webhook выводится из токена:
настраивать их не нужно. При старте бот сам ставит webhook, команды и кнопку меню «Приложение».

## 3. Mini App в @BotFather

1. `/mybots` → ваш бот → **Bot Settings → Configure Mini App → Enable Mini App**.
2. URL: `https://<имя>.onrender.com/miniapp`.

Так Mini App открывается из профиля бота и по прямой ссылке `https://t.me/<бот>?startapp` — её и укажите в форме сдачи.

## 4. Проверка

1. В Telegram: `/start` → выберите демо-персону (клиент, менеджер, аналитик).
2. «📱 Открыть приложение» или кнопка «Приложение» в меню. Сменить роль: «Профиль» → «Сменить демо-роль».
3. Клиент: «Рассчитать лимит» → заявка → в боте придёт уведомление о статусе после действий менеджера.

## Перед финалом

- За 5 минут до выступления откройте `/miniapp` или напишите боту, чтобы разбудить сервис.
- Чтобы не засыпал весь день: бесплатный пинг `https://<имя>.onrender.com/api/health` раз в 10 минут
  (например, cron-job.org). Бесплатных 750 часов в месяц хватает на работу без перерыва.
- Обновить код: загрузите изменённые файлы в репозиторий — Render пересоберёт сервис сам.
