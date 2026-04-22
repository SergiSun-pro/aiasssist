# Обновление проекта на VPS из GitHub

Эта инструкция для сервера Ubuntu, где проект расположен в `/var/www/aiasssist` и backend запущен через `pm2` с именем `aiasssist-backend`.

## 1) Подключение к серверу

```bash
ssh root@135.136.187.225
```
Пароль: ^`(B'SvdMF^Djr2w

## 2) Переход в папку проекта

```bash
cd /var/www/aiasssist
```

## 3) Подтянуть свежий код

```bash
git pull origin main
```

## 4) Установить/обновить зависимости

```bash
npm install
```

## 5) Пересобрать фронтенд

```bash
npm run build
```

## 6) Перезапустить backend

```bash
pm2 restart aiasssist-backend
pm2 save
```

## 7) Проверки после обновления

```bash
pm2 status
curl -s http://127.0.0.1:8787/api/health
curl -I http://127.0.0.1
```

Ожидается:
- `pm2` показывает `online`
- health endpoint возвращает `{"ok":true}`
- Nginx отвечает `HTTP/1.1 200 OK`

---

## Быстрый вариант (одним блоком)

```bash
cd /var/www/aiasssist && \
git pull origin main && \
npm install && \
npm run build && \
pm2 restart aiasssist-backend && \
pm2 save && \
pm2 status
```

---

## Если что-то пошло не так

### Логи backend

```bash
pm2 logs aiasssist-backend --lines 100
```

### Проверка Nginx

```bash
nginx -t
systemctl status nginx --no-pager -l
```

### Откат на предыдущий коммит

```bash
cd /var/www/aiasssist
git log --oneline -n 5
git reset --hard HEAD~1
npm install
npm run build
pm2 restart aiasssist-backend
```

> Используй откат только если точно понимаешь, что нужно вернуть предыдущую версию.
