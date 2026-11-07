# Arseniy Move

Android-приложение для тренировок Арсения. Текущая версия **1.0.14**, код сборки 15.

- [Установить APK 1.0.14](https://github.com/holodilow-sudo/arseniyMove/releases/download/v1.0.14/ArseniyMove-1.0.14.apk)
- [Все релизы](https://github.com/holodilow-sudo/arseniyMove/releases)
- [Полный архив исходников 1.0.14](ArseniyMove-1.0.14-source.zip)
- [Состав и контрольные суммы исходников](SOURCE-1.0.14.json)

В архиве: app/, Android-оболочка, модели и ресурсы, скрипты сборки и проверки, документация и страница графиков. Начните с BUILDING.md внутри архива. Для сборки нужны Windows, Python 3, JDK 17 и Android SDK 35. Приватный ключ подписи хранится у владельца и не публикуется.

Обновления читаются из публичных GitHub Releases без входа и ключей на телефоне. Приложение скачивает новую версию при открытии, установку подтверждает пользователь. Для версии 1.0.11 и старее один раз установите новый APK поверх прежнего, без удаления и очистки данных.

В 1.0.14 функции тренировок совпадают с 1.0.13, повышен номер версии. Автоматическая отправка статистики не подключена.

## Build and release

[GitHub Actions: automatic APK builds and releases](CI.md). [Local build instructions](BUILDING.md). Source folders are app/, android/, scripts/ and docs/. Signing credentials are private GitHub Secrets and are never committed.
