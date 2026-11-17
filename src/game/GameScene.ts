import Phaser from 'phaser';
import {
  BUILDING,
  ECONOMY,
  PHASES,
  UPGRADES,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './level';
import type { Phase, UpgradeId, Wall } from './level';
import { generateLevel } from './generator';
import type { GeneratedLevel } from './generator';

// ---- Игрок ----
const PLAYER_SPEED = 260;
const PLAYER_SIZE = 36;
const PLAYER_COLOR = 0x38bdf8;
const PLAYER_MAX_HP = 100;
const PLAYER_INVULN_MS = 600;
const PLAYER_DAMAGE = 20;

// ---- Прокачка ----
const ARMOR_PER_LEVEL = 50;
const FIRE_RATE_PER_LEVEL = 0.25;
const DAMAGE_PER_LEVEL = 10;
const SPEED_PER_LEVEL = 0.15;

// ---- Враги ----
const ENEMY_SIZE = 32;
const ENEMY_COLOR = 0xef4444;
const ENEMY_SPEED = 60;
const ENEMY_HP = 30;
const ENEMY_DAMAGE = 20;

// ---- Заложники ----
const HOSTAGE_SIZE = 26;
const HOSTAGE_COLOR = 0x4ade80;
const HOSTAGE_RESCUED_COLOR = 0xa3e635;
const HOSTAGE_FOLLOW_SPEED = 210;
const HOSTAGE_FOLLOW_DISTANCE = 70;
const HOSTAGE_PICKUP_RADIUS = 60;

// ---- Пули ----
const BULLET_RADIUS = 4;
const PLAYER_BULLET_SPEED = 520;
const PLAYER_BULLET_COLOR = 0xfacc15;
const PLAYER_SHOOT_COOLDOWN_MS = 280;
const ENEMY_BULLET_SPEED = 320;
const ENEMY_BULLET_COLOR = 0xf87171;

// ---- Прицел ----
const AIM_LENGTH = 70;
const AIM_COLOR = 0xfacc15;

// ---- Фазы ----
const PHASE_BANNER_MS = 2500;

// ---- Оформление ----
const WALL_COLOR = 0x64748b;
const FLOOR_COLOR = 0x1e293b;
const EVAC_COLOR = 0x22c55e;

// ---- Магазин ----
const SHOP_PANEL_COLOR = 0x0b1220;
const CARD_COLOR = 0x1e293b;
const CARD_STROKE = 0x475569;
const CARD_W = 330;
const CARD_H = 132;

// ---- Экономика (localStorage) ----
const WALLET_KEY = 'ron.wallet';
const BEST_RUN_KEY = 'ron.bestRun';

interface Bullet {
  sprite: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
  fromPlayer: boolean;
}

interface Hostage {
  sprite: Phaser.GameObjects.Arc;
  rescued: boolean;
}

interface ShopCard {
  upgradeId: UpgradeId;
  background: Phaser.GameObjects.Rectangle;
  pips: Phaser.GameObjects.Text;
  price: Phaser.GameObjects.Text;
}

/**
 * Вертикальный срез: магазин с карточками, 4 ветки прокачки,
 * баланс врагов и пауза.
 *
 * Управление: WASD — движение, стрелки или курсор — прицел,
 * пробел — выстрел, E — забрать заложника, P — пауза, R — рестарт.
 * В магазине: клик по карточке или клавиши 1–4, пробел — начать миссию.
 */
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private playerBody!: Phaser.Physics.Arcade.Body;

  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private hostageGroup!: Phaser.Physics.Arcade.Group;
  private hostages: Hostage[] = [];
  private bullets: Bullet[] = [];
  private levelWalls: Wall[] = [];
  private generated!: GeneratedLevel;

  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private aimKeys!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private fireKey!: Phaser.Input.Keyboard.Key;
  private rescueKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private pauseKey!: Phaser.Input.Keyboard.Key;
  private shopKeys: Phaser.Input.Keyboard.Key[] = [];

  private hudText!: Phaser.GameObjects.Text;
  private pickupHint!: Phaser.GameObjects.Text;
  private phaseBanner!: Phaser.GameObjects.Text;
  private aimLine!: Phaser.GameObjects.Line;
  private evacRect!: Phaser.Geom.Rectangle;

  private shopContainer!: Phaser.GameObjects.Container;
  private shopWalletText!: Phaser.GameObjects.Text;
  private shopMessageText!: Phaser.GameObjects.Text;
  private shopCards: ShopCard[] = [];
  private pauseContainer!: Phaser.GameObjects.Container;

  private hp = PLAYER_MAX_HP;
  private maxHp = PLAYER_MAX_HP;
  private wallet = 0;
  private moneyEarned = 0;
  private bestRun = 0;
  private upgradeLevels: Record<UpgradeId, number> = {
    armor: 0,
    fireRate: 0,
    damage: 0,
    speed: 0,
  };
  private shopOpen = true;
  private shopMessage = '';
  private paused = false;
  private lastPlayerShot = 0;
  private invulnUntil = 0;
  private enemiesKilled = 0;
  private enemiesTotal = 0;
  private hostagesEvacuated = 0;
  private gameOver = false;
  private phaseIndex = 0;
  private aimAngle = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;

  constructor() {
    super('GameScene');
  }

  private get phase(): Phase {
    return PHASES[this.phaseIndex];
  }

  create(): void {
    // Важно: сцена переиспользуется при рестарте, поля класса
    // нужно сбрасывать здесь, иначе игра «зависает» после R.
    this.lastPlayerShot = 0;
    this.invulnUntil = 0;
    this.enemiesKilled = 0;
    this.enemiesTotal = 0;
    this.hostagesEvacuated = 0;
    this.gameOver = false;
    this.paused = false;
    this.phaseIndex = 0;
    this.aimAngle = 0;
    this.bullets = [];
    this.hostages = [];
    this.shopCards = [];
    this.moneyEarned = 0;
    this.upgradeLevels = { armor: 0, fireRate: 0, damage: 0, speed: 0 };
    this.shopOpen = true;
    this.shopMessage = '';
    this.wallet = this.readNumber(WALLET_KEY, 0);
    this.bestRun = this.readNumber(BEST_RUN_KEY, 0);
    this.applyStats();

    this.physics.resume();
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Новая планировка здания на каждый запуск сцены
    this.generated = generateLevel();
    this.levelWalls = this.generated.walls;

    // Пол здания (рисуется под стенами)
    this.add
      .rectangle(BUILDING.x, BUILDING.y, BUILDING.width, BUILDING.height, FLOOR_COLOR)
      .setOrigin(0);

    // Стены как статические тела
    this.walls = this.physics.add.staticGroup();
    for (const wall of this.levelWalls) {
      const rect = this.add
        .rectangle(wall.x, wall.y, wall.width, wall.height, WALL_COLOR)
        .setOrigin(0);
      this.walls.add(rect);
    }

    // Игрок — динамическое физическое тело
    const spawnX = Phaser.Math.Clamp(this.generated.entrance.x - 100, 440, 1440);
    this.player = this.add.rectangle(
      spawnX,
      1240,
      PLAYER_SIZE,
      PLAYER_SIZE,
      PLAYER_COLOR,
    );
    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setSize(PLAYER_SIZE - 6, PLAYER_SIZE - 6);
    this.playerBody.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);

    // Враги: прямоугольники с динамическим телом и маршрутом патруля
    this.enemyGroup = this.physics.add.group();
    for (const patrol of this.generated.enemyPatrols) {
      this.createEnemy(patrol);
    }
    this.physics.add.collider(this.enemyGroup, this.walls);
    this.physics.add.collider(this.player, this.enemyGroup);

    // Заложники: круги с динамическим телом
    this.hostageGroup = this.physics.add.group();
    for (const spawn of this.generated.hostageSpawns) {
      const sprite = this.add.circle(spawn.x, spawn.y, HOSTAGE_SIZE, HOSTAGE_COLOR);
      this.hostageGroup.add(sprite);
      this.hostages.push({ sprite, rescued: false });
    }
    this.physics.add.collider(this.hostageGroup, this.walls);
    this.physics.add.collider(this.hostageGroup, this.enemyGroup);

    // Зона эвакуации на улице под входной дверью
    const evacX = this.generated.entrance.x - 30;
    const evacWidth = this.generated.entrance.width + 60;
    this.evacRect = new Phaser.Geom.Rectangle(evacX, 1170, evacWidth, 75);
    this.add
      .rectangle(evacX, 1170, evacWidth, 75, EVAC_COLOR, 0.12)
      .setOrigin(0)
      .setStrokeStyle(2, EVAC_COLOR, 0.9);
    this.add
      .text(evacX + evacWidth / 2, 1160, 'ЭВАКУАЦИЯ', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#bbf7d0',
      })
      .setOrigin(0.5, 1);

    // Управление: WASD — движение, стрелки — прицел
    if (!this.input.keyboard) {
      throw new Error('Keyboard input is unavailable.');
    }
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
    this.aimKeys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    }) as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
    this.fireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.rescueKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.pauseKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.shopKeys = [
      this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
    ];

    // Камера следует за игроком по всему миру
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    // Прицел: линия от игрока в направлении стрельбы
    this.aimLine = this.add.line(0, 0, 0, 0, AIM_LENGTH, 0, AIM_COLOR, 0.55).setOrigin(0, 0);

    // HUD (закреплён на экране)
    this.hudText = this.add
      .text(16, 12, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#ffffff',
      })
      .setScrollFactor(0)
      .setDepth(10);
    this.pickupHint = this.add
      .text(0, 0, 'E — забрать заложника', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#a3e635',
      })
      .setOrigin(0.5, 1)
      .setDepth(9)
      .setVisible(false);

    // Объявление о входе в новую фазу
    this.phaseBanner = this.add
      .text(this.scale.width / 2, this.scale.height / 3, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '40px',
        color: '#f87171',
        backgroundColor: '#111827cc',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(15)
      .setVisible(false);

    this.createShop();
    this.createPauseOverlay();
    this.updateHud();
  }

  update(time: number, delta: number): void {
    const seconds = delta / 1000;

    if (this.gameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        this.scene.restart();
      }
      return;
    }

    if (this.shopOpen) {
      this.updateShop();
      return;
    }

    if (this.paused) {
      if (Phaser.Input.Keyboard.JustDown(this.pauseKey)) {
        this.resumeGame();
      } else if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
        this.scene.restart();
      }
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.pauseKey)) {
      this.pauseGame();
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.scene.restart();
      return;
    }

    this.movePlayer(time);
    this.updateAim();
    this.updatePhase();
    this.updateEnemies(time);
    this.updateHostages();
    this.updatePickupHint();
    this.updateBullets(seconds);
    this.checkEvacuation();
    this.updateHud();
  }

  // ---------------------------------------------------------------------------
  // Магазин
  // ---------------------------------------------------------------------------

  private createShop(): void {
    const cx = this.scale.width / 2;
    const panelW = 760;
    const panelH = 580;
    const container = this.add.container(0, 0).setScrollFactor(0).setDepth(30);

    const panel = this.add
      .rectangle(cx, this.scale.height / 2, panelW, panelH, SHOP_PANEL_COLOR, 0.97)
      .setStrokeStyle(2, 0x334155);
    const title = this.add
      .text(cx, 62, 'ПОДГОТОВКА К ОПЕРАЦИИ', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '26px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.shopWalletText = this.add
      .text(cx, 98, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);

    container.add([panel, title, this.shopWalletText]);

    // Карточки апгрейдов 2×2
    const cardCenters = [
      { x: cx - 170, y: 205 },
      { x: cx + 170, y: 205 },
      { x: cx - 170, y: 355 },
      { x: cx + 170, y: 355 },
    ];

    UPGRADES.forEach((upgrade, index) => {
      const pos = cardCenters[index];
      const background = this.add
        .rectangle(pos.x, pos.y, CARD_W, CARD_H, CARD_COLOR, 1)
        .setStrokeStyle(2, CARD_STROKE)
        .setInteractive({ useHandCursor: true });
      background.on('pointerdown', () => {
        if (this.shopOpen) this.tryBuy(upgrade.id);
      });

      const icon = this.add
        .text(pos.x - 120, pos.y - 8, upgrade.icon, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '40px',
        })
        .setOrigin(0.5);

      const name = this.add.text(pos.x - 85, pos.y - 56, upgrade.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffffff',
      });

      const description = this.add.text(pos.x - 85, pos.y - 30, upgrade.description, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#94a3b8',
      });

      const pips = this.add.text(pos.x - 85, pos.y + 2, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#facc15',
      });

      const price = this.add.text(pos.x - 85, pos.y + 28, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: '#4ade80',
      });

      const keyHint = this.add
        .text(pos.x + 142, pos.y - 58, `[${index + 1}]`, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '14px',
          color: '#64748b',
        })
        .setOrigin(1, 0);

      container.add([background, icon, name, description, pips, price, keyHint]);
      this.shopCards.push({ upgradeId: upgrade.id, background, pips, price });
    });

    this.shopMessageText = this.add
      .text(cx, 468, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        color: '#fca5a5',
      })
      .setOrigin(0.5);

    const startButton = this.add
      .rectangle(cx, 515, 400, 48, 0x22c55e, 1)
      .setStrokeStyle(2, 0x16a34a)
      .setInteractive({ useHandCursor: true });
    startButton.on('pointerdown', () => {
      if (this.shopOpen) this.startMission();
    });
    const startLabel = this.add
      .text(cx, 515, 'НАЧАТЬ ОПЕРАЦИЮ (ПРОБЕЛ)', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#052e16',
      })
      .setOrigin(0.5);

    const controls = this.add
      .text(cx, 570, 'WASD — движение · стрелки — прицел · пробел — выстрел · E — заложник · P — пауза', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);

    container.add([this.shopMessageText, startButton, startLabel, controls]);

    this.shopContainer = container;
    this.renderShop();
  }

  private updateShop(): void {
    this.shopKeys.forEach((key, index) => {
      if (Phaser.Input.Keyboard.JustDown(key)) {
        this.tryBuy(UPGRADES[index].id);
      }
    });

    this.renderShop();

    if (Phaser.Input.Keyboard.JustDown(this.fireKey)) {
      this.startMission();
    }
  }

  private startMission(): void {
    this.shopOpen = false;
    this.shopMessage = '';
    this.shopContainer.setVisible(false);
    this.applyStats();
  }

  private currentPrice(upgradeId: UpgradeId): number {
    const upgrade = UPGRADES.find((item) => item.id === upgradeId);
    if (!upgrade) return 0;
    return upgrade.basePrice + upgrade.priceStep * this.upgradeLevels[upgradeId];
  }

  private tryBuy(upgradeId: UpgradeId): void {
    const upgrade = UPGRADES.find((item) => item.id === upgradeId);
    if (!upgrade) return;

    const level = this.upgradeLevels[upgradeId];
    if (level >= upgrade.maxLevel) {
      this.shopMessage = `${upgrade.name}: максимальный уровень`;
      return;
    }

    const price = this.currentPrice(upgradeId);
    if (this.wallet < price) {
      this.shopMessage = 'Недостаточно денег';
      return;
    }

    this.wallet -= price;
    this.writeNumber(WALLET_KEY, this.wallet);
    this.upgradeLevels[upgradeId] = level + 1;
    this.applyStats();
    this.shopMessage = `${upgrade.name}: уровень ${level + 1}`;
    this.renderShop();
  }

  private renderShop(): void {
    this.shopWalletText.setText(
      `Кошелёк: ${this.wallet}₽   ·   Рекорд миссии: ${this.bestRun}₽`,
    );
    this.shopMessageText.setText(this.shopMessage);

    for (const card of this.shopCards) {
      const upgrade = UPGRADES.find((item) => item.id === card.upgradeId);
      if (!upgrade) continue;

      const level = this.upgradeLevels[card.upgradeId];
      const maxed = level >= upgrade.maxLevel;
      const price = this.currentPrice(card.upgradeId);
      const affordable = this.wallet >= price;

      card.pips.setText('●'.repeat(level) + '○'.repeat(upgrade.maxLevel - level));
      card.price.setText(maxed ? 'MAX' : `${price}₽`);
      card.price.setColor(maxed ? '#94a3b8' : affordable ? '#4ade80' : '#f87171');
      card.background.setStrokeStyle(2, maxed ? 0x22c55e : CARD_STROKE);
    }
  }

  // ---------------------------------------------------------------------------
  // Пауза
  // ---------------------------------------------------------------------------

  private createPauseOverlay(): void {
    const container = this.add.container(0, 0).setScrollFactor(0).setDepth(25);
    const dim = this.add.rectangle(
      this.scale.width / 2,
      this.scale.height / 2,
      this.scale.width,
      this.scale.height,
      0x000000,
      0.65,
    );
    const title = this.add
      .text(this.scale.width / 2, this.scale.height / 2 - 40, 'ПАУЗА', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '52px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    const hint = this.add
      .text(this.scale.width / 2, this.scale.height / 2 + 30, 'P — продолжить · R — начать заново', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);

    container.add([dim, title, hint]);
    container.setVisible(false);
    this.pauseContainer = container;
  }

  private pauseGame(): void {
    this.paused = true;
    this.physics.pause();
    this.pauseContainer.setVisible(true);
  }

  private resumeGame(): void {
    this.paused = false;
    this.physics.resume();
    this.pauseContainer.setVisible(false);
  }

  // ---------------------------------------------------------------------------
  // Игровой цикл
  // ---------------------------------------------------------------------------

  private applyStats(): void {
    this.maxHp = PLAYER_MAX_HP + this.upgradeLevels.armor * ARMOR_PER_LEVEL;
    this.hp = this.maxHp;
  }

  private playerDamage(): number {
    return PLAYER_DAMAGE + this.upgradeLevels.damage * DAMAGE_PER_LEVEL;
  }

  private playerFireCooldownMs(): number {
    return PLAYER_SHOOT_COOLDOWN_MS * (1 - this.upgradeLevels.fireRate * FIRE_RATE_PER_LEVEL);
  }

  private playerSpeed(): number {
    return PLAYER_SPEED * (1 + this.upgradeLevels.speed * SPEED_PER_LEVEL);
  }

  private movePlayer(time: number): void {
    let dx = 0;
    let dy = 0;

    if (this.wasd.left.isDown) dx -= 1;
    if (this.wasd.right.isDown) dx += 1;
    if (this.wasd.up.isDown) dy -= 1;
    if (this.wasd.down.isDown) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      const speed = this.playerSpeed();
      this.playerBody.setVelocity((dx / length) * speed, (dy / length) * speed);
    } else {
      this.playerBody.setVelocity(0, 0);
    }

    // Выстрел: пробел, пуля летит по направлению прицела
    if (
      Phaser.Input.Keyboard.JustDown(this.fireKey) &&
      time - this.lastPlayerShot >= this.playerFireCooldownMs()
    ) {
      this.spawnBullet(this.player.x, this.player.y, this.aimAngle, PLAYER_BULLET_SPEED, true);
      this.lastPlayerShot = time;
    }
  }

  private spawnBullet(x: number, y: number, angle: number, speed: number, fromPlayer: boolean): void {
    const color = fromPlayer ? PLAYER_BULLET_COLOR : ENEMY_BULLET_COLOR;
    const sprite = this.add.circle(x, y, BULLET_RADIUS, color);
    this.bullets.push({
      sprite,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      fromPlayer,
    });
  }

  /** Прицел: стрелки задают направление, иначе — курсор. */
  private updateAim(): void {
    const pointer = this.input.activePointer;
    let ax = 0;
    let ay = 0;

    if (this.aimKeys.left.isDown) ax -= 1;
    if (this.aimKeys.right.isDown) ax += 1;
    if (this.aimKeys.up.isDown) ay -= 1;
    if (this.aimKeys.down.isDown) ay += 1;

    if (ax !== 0 || ay !== 0) {
      this.aimAngle = Math.atan2(ay, ax);
    } else if (
      pointer.worldX !== this.lastPointerX ||
      pointer.worldY !== this.lastPointerY
    ) {
      this.aimAngle = Math.atan2(pointer.worldY - this.player.y, pointer.worldX - this.player.x);
    }
    this.lastPointerX = pointer.worldX;
    this.lastPointerY = pointer.worldY;

    this.aimLine.setTo(
      0,
      0,
      Math.cos(this.aimAngle) * AIM_LENGTH,
      Math.sin(this.aimAngle) * AIM_LENGTH,
    );
    this.aimLine.setPosition(this.player.x, this.player.y);
  }

  /** Переход к следующей фазе по числу спасённых заложников. */
  private updatePhase(): void {
    const next = PHASES[this.phaseIndex + 1];
    if (!next || this.hostagesEvacuated < next.hostagesRequired) return;

    this.phaseIndex += 1;
    const phase = this.phase;

    if (phase.reinforcements > 0) {
      this.spawnReinforcements(phase.reinforcements);
    }

    this.phaseBanner.setText(`⚠ ФАЗА ${this.phaseIndex + 1}: ${phase.name} — враги усилены!`);
    this.phaseBanner.setVisible(true);
    this.time.delayedCall(PHASE_BANNER_MS, () => this.phaseBanner.setVisible(false));
  }

  private spawnReinforcements(count: number): void {
    for (let i = 0; i < count; i++) {
      const route = Phaser.Utils.Array.GetRandom(this.generated.enemyPatrols);
      this.createEnemy(route);
    }
  }

  private createEnemy(patrol: { sx: number; sy: number; ex: number; ey: number }): void {
    const enemy = this.add.rectangle(patrol.sx, patrol.sy, ENEMY_SIZE, ENEMY_SIZE, ENEMY_COLOR);
    enemy.setData('route', patrol);
    enemy.setData('target', { x: patrol.ex, y: patrol.ey });
    enemy.setData('lastShot', 0);
    enemy.setData('hp', ENEMY_HP);
    this.enemyGroup.add(enemy);
    this.enemiesTotal += 1;
  }

  private updateEnemies(time: number): void {
    const phase = this.phase;

    for (const enemy of this.enemyGroup.getChildren() as Phaser.GameObjects.Rectangle[]) {
      const body = enemy.body as Phaser.Physics.Arcade.Body;
      const route = enemy.getData('route') as { sx: number; sy: number; ex: number; ey: number };
      const target = enemy.getData('target') as { x: number; y: number };

      // Патруль по прямой туда-обратно
      const distToTarget = Phaser.Math.Distance.Between(enemy.x, enemy.y, target.x, target.y);
      if (distToTarget < 10) {
        const goingToEnd = target.x === route.ex && target.y === route.ey;
        enemy.setData('target', goingToEnd ? { x: route.sx, y: route.sy } : { x: route.ex, y: route.ey });
        body.setVelocity(0, 0);
      } else {
        const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
        const speed = ENEMY_SPEED * phase.enemySpeedMultiplier;
        body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
      }

      // Стрельба по игроку: рядом и есть прямая видимость
      const distToPlayer = Phaser.Math.Distance.Between(
        enemy.x,
        enemy.y,
        this.player.x,
        this.player.y,
      );
      if (
        distToPlayer <= phase.enemyAggroRange &&
        this.canSee(enemy.x, enemy.y, this.player.x, this.player.y) &&
        time - (enemy.getData('lastShot') as number) >= phase.enemyFireCooldownMs
      ) {
        const angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
        this.spawnBullet(enemy.x, enemy.y, angle, ENEMY_BULLET_SPEED, false);
        enemy.setData('lastShot', time);
      }
    }
  }

  private updateHostages(): void {
    for (const hostage of this.hostages) {
      if (!hostage.rescued) continue;
      const body = hostage.sprite.body as Phaser.Physics.Arcade.Body;
      const distToPlayer = Phaser.Math.Distance.Between(
        hostage.sprite.x,
        hostage.sprite.y,
        this.player.x,
        this.player.y,
      );

      if (distToPlayer > HOSTAGE_FOLLOW_DISTANCE) {
        const angle = Math.atan2(this.player.y - hostage.sprite.y, this.player.x - hostage.sprite.x);
        body.setVelocity(Math.cos(angle) * HOSTAGE_FOLLOW_SPEED, Math.sin(angle) * HOSTAGE_FOLLOW_SPEED);
      } else {
        body.setVelocity(0, 0);
      }
    }
  }

  private updatePickupHint(): void {
    let nearest: Hostage | null = null;
    let bestDist = Infinity;

    for (const hostage of this.hostages) {
      if (hostage.rescued) continue;
      const dist = Phaser.Math.Distance.Between(
        hostage.sprite.x,
        hostage.sprite.y,
        this.player.x,
        this.player.y,
      );
      if (dist < HOSTAGE_PICKUP_RADIUS && dist < bestDist) {
        nearest = hostage;
        bestDist = dist;
      }
    }

    if (nearest) {
      this.pickupHint.setPosition(nearest.sprite.x, nearest.sprite.y - HOSTAGE_SIZE - 6);
      this.pickupHint.setVisible(true);
      if (Phaser.Input.Keyboard.JustDown(this.rescueKey)) {
        nearest.rescued = true;
        nearest.sprite.setFillStyle(HOSTAGE_RESCUED_COLOR);
      }
    } else {
      this.pickupHint.setVisible(false);
    }
  }

  private updateBullets(seconds: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      const sprite = bullet.sprite;
      sprite.x += bullet.vx * seconds;
      sprite.y += bullet.vy * seconds;

      let hit = false;

      if (
        sprite.x < 0 ||
        sprite.x > WORLD_WIDTH ||
        sprite.y < 0 ||
        sprite.y > WORLD_HEIGHT ||
        this.pointInWall(sprite.x, sprite.y)
      ) {
        hit = true;
      } else if (bullet.fromPlayer) {
        for (const enemy of this.enemyGroup.getChildren() as Phaser.GameObjects.Rectangle[]) {
          if (
            Phaser.Math.Distance.Between(sprite.x, sprite.y, enemy.x, enemy.y) <
            ENEMY_SIZE / 2 + BULLET_RADIUS
          ) {
            this.damageEnemy(enemy);
            hit = true;
            break;
          }
        }
      } else if (
        Phaser.Math.Distance.Between(sprite.x, sprite.y, this.player.x, this.player.y) <
        PLAYER_SIZE / 2 + BULLET_RADIUS
      ) {
        this.damagePlayer();
        hit = true;
      }

      if (hit) {
        sprite.destroy();
        this.bullets.splice(i, 1);
      }
    }
  }

  private damageEnemy(enemy: Phaser.GameObjects.Rectangle): void {
    const hp = (enemy.getData('hp') as number) - this.playerDamage();
    enemy.setData('hp', hp);

    if (hp <= 0) {
      enemy.destroy();
      this.enemiesKilled += 1;
      this.addMoney(ECONOMY.enemyReward);
      return;
    }

    // Вспышка при попадании, но враг ещё жив
    enemy.setFillStyle(0xffffff);
    this.time.delayedCall(90, () => {
      if (enemy.active) enemy.setFillStyle(ENEMY_COLOR);
    });
  }

  private damagePlayer(): void {
    if (this.time.now < this.invulnUntil) return;

    this.hp -= ENEMY_DAMAGE;
    this.invulnUntil = this.time.now + PLAYER_INVULN_MS;
    this.player.setFillStyle(0xff0000);
    this.time.delayedCall(120, () => this.player.setFillStyle(PLAYER_COLOR));

    if (this.hp <= 0) {
      this.hp = 0;
      this.endGame('defeat');
    }
  }

  private checkEvacuation(): void {
    for (let i = this.hostages.length - 1; i >= 0; i--) {
      const hostage = this.hostages[i];
      if (!hostage.rescued) continue;
      if (this.evacRect.contains(hostage.sprite.x, hostage.sprite.y)) {
        hostage.sprite.destroy();
        this.hostages.splice(i, 1);
        this.hostagesEvacuated += 1;
        this.addMoney(ECONOMY.hostageReward);
      }
    }

    if (this.hostagesEvacuated >= this.generated.hostageSpawns.length) {
      this.endGame('win');
    }
  }

  private endGame(result: 'win' | 'defeat'): void {
    this.gameOver = true;
    this.playerBody.setVelocity(0, 0);
    this.pickupHint.setVisible(false);

    if (this.moneyEarned > this.bestRun) {
      this.bestRun = this.moneyEarned;
      this.writeNumber(BEST_RUN_KEY, this.bestRun);
    }

    const title = result === 'win' ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ';
    const subtitle =
      result === 'win'
        ? `Все заложники эвакуированы. Заработано ${this.moneyEarned}₽.`
        : `Оперативник выбыл. Заработано ${this.moneyEarned}₽.`;
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    this.add
      .rectangle(cx, cy, this.scale.width, this.scale.height, 0x000000, 0.7)
      .setScrollFactor(0)
      .setDepth(20);
    this.add
      .text(cx, cy - 20, title, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '48px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(21);
    this.add
      .text(cx, cy + 30, `${subtitle} Рекорд миссии: ${this.bestRun}₽. Нажми R.`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#cbd5e1',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(21);
  }

  private addMoney(amount: number): void {
    this.wallet += amount;
    this.moneyEarned += amount;
    this.writeNumber(WALLET_KEY, this.wallet);
  }

  private readNumber(key: string, fallback: number): number {
    try {
      const raw = window.localStorage.getItem(key);
      const value = raw === null ? Number.NaN : Number(raw);
      return Number.isFinite(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  private writeNumber(key: string, value: number): void {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      // localStorage недоступен — играем без сохранений
    }
  }

  /** Проверка прямой видимости: не пересекает ли отрезок стену. */
  private canSee(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const dist = Phaser.Math.Distance.Between(fromX, fromY, toX, toY);
    const steps = Math.max(1, Math.ceil(dist / 24));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.pointInWall(Phaser.Math.Linear(fromX, toX, t), Phaser.Math.Linear(fromY, toY, t))) {
        return false;
      }
    }
    return true;
  }

  private pointInWall(x: number, y: number): boolean {
    return this.levelWalls.some(
      (w) => x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height,
    );
  }

  private updateHud(): void {
    this.hudText.setText(
      [
        `Фаза: ${this.phase.name}`,
        `HP: ${this.hp}/${this.maxHp}`,
        `Заложники: ${this.hostagesEvacuated}/${this.generated.hostageSpawns.length}`,
        `Враги: ${this.enemiesKilled}/${this.enemiesTotal}`,
        `Кошелёк: ${this.wallet}₽ (+${this.moneyEarned})`,
      ].join('\n'),
    );
  }
}
