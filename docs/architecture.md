# Архитектура игры ron

Схема классов и связей. Игра — одна сцена Phaser ([`GameScene`](../src/game/GameScene.ts)),
которая координирует модули: данные уровня, процедурный генератор планировки
и сущности (игрок, враги, заложники, пули).

```mermaid
classDiagram
    direction LR

    class MainTS["src/main.ts"] {
        точка входа
        +createGame('game')
    }

    class Config["src/game/config.ts"] {
        настройки Phaser
        +createGame(parent) Game
        -physics: arcade
    }

    class GameScene["src/game/GameScene.ts"] {
        координация кадра и правил
        -player: Rectangle
        -playerBody: Arcade.Body
        -walls: StaticGroup
        -enemyGroup: Group
        -hostageGroup: Group
        -hostages: Hostage[]
        -bullets: Bullet[]
        -levelWalls: Wall[]
        -generated: GeneratedLevel
        -phaseIndex: number
        -hp / maxHp / wallet / moneyEarned / bestRun
        +create() void
        +update(time, delta) void
        -movePlayer(time) void
        -updateAim() void
        -updatePhase() void
        -updateEnemies(time) void
        -updateHostages() void
        -updateBullets(seconds) void
        -checkEvacuation() void
        -endGame(result) void
        -canSee(x1, y1, x2, y2) boolean
        -updateShop() / tryBuy() / renderShop()
        -readNumber() / writeNumber()
    }

    class LevelData["src/game/level.ts — данные и баланс"] {
        +PHASES: Phase[]
        +ECONOMY
        +BUILDING: Rect
        +WORLD_WIDTH / WORLD_HEIGHT
        +WALLS / ENEMY_PATROLS / HOSTAGE_SPAWNS
        +Wall / Point / PatrolRoute / Phase / Rect
    }

    class Generator["src/game/generator.ts"] {
        процедурная генерация
        +generateLevel() GeneratedLevel
        -wallWithDoor(x1, y1, x2, y2, horizontal) Wall[]
        -randInt(min, max) number
    }

    class GeneratedLevel["GeneratedLevel (тип)"] {
        +walls: Wall[]
        +enemyPatrols: PatrolRoute[]
        +hostageSpawns: Point[]
        +entrance
    }

    class Bullet["Bullet (тип)"] {
        +sprite: Arc
        +vx: number
        +vy: number
        +fromPlayer: boolean
    }

    class Hostage["Hostage (тип)"] {
        +sprite: Arc
        +rescued: boolean
    }

    class Phaser["Phaser 4"] {
        Scene
        Arcade Physics
        GameObjects (Rectangle, Arc, Text, Line)
        Input.Keyboard
        Camera
    }

    MainTS --> Config : createGame
    Config --> GameScene : регистрирует сцену
    Config --> Phaser
    GameScene --> Phaser
    GameScene --> LevelData : PHASES, ECONOMY, BUILDING
    GameScene --> Generator : generateLevel()
    Generator --> LevelData : BUILDING, типы
    GameScene ..> GeneratedLevel : результат генерации
    GameScene *-- Bullet : массив bullets
    GameScene *-- Hostage : массив hostages
```

## Поток одного кадра

1. `GameScene.update()` — если магазин открыт, обрабатывает только покупки;
   если игра окончена — только рестарт по `R`.
2. `movePlayer()` — WASD задаёт скорость тела игрока; пробел стреляет по прицелу.
3. `updateAim()` — прицел: стрелки или курсор, рисуется линией `aimLine`.
4. `updatePhase()` — переход между фазами из `PHASES` по числу спасённых заложников;
   вход в фазу усиливает врагов и добавляет подкрепление.
5. `updateEnemies()` — патрули, агрессия и стрельба по игроку (с проверкой прямой
   видимости через `canSee()`); параметры берутся из текущей фазы.
6. `updateHostages()` — спасённые заложники следуют за игроком.
7. `updateBullets()` — движение пуль, попадания в стены/врагов/игрока, награды.
8. `checkEvacuation()` — заложники в зоне эвакуации засчитываются; все спасены — победа.

## Данные между сессиями

- `localStorage` ключи `ron.wallet` (кошелёк) и `ron.bestRun` (рекорд миссии) —
  читаются и пишутся в `GameScene` через `readNumber()` / `writeNumber()`.
- Всё остальное состояние (планировка, враги, заложники, HP) создаётся заново
  в `create()` при каждом запуске сцены.
