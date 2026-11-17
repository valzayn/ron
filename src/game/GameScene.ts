import Phaser from 'phaser';
import {
  BUILDING,
  ECONOMY,
  PHASES,
  UPGRADES,
  WEAPONS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './level';
import type { Phase, UpgradeId, Wall, Weapon, WeaponId } from './level';
import { generateLevel } from './generator';
import type { GeneratedLevel } from './generator';

// ---- Игрок ----
const PLAYER_SPEED = 260;
const PLAYER_SIZE = 36;
const PLAYER_COLOR = 0x38bdf8;
const PLAYER_MAX_HP = 100;
const PLAYER_INVULN_MS = 600;

// ---- Прокачка (сохраняется между миссиями) ----
const ARMOR_PER_LEVEL = 15;
const FIRE_RATE_PER_LEVEL = 0.08;
const DAMAGE_PER_LEVEL = 4;
const SPEED_PER_LEVEL = 0.05;

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

// ---- Аптечки ----
const MEDKIT_HEAL = 30;
const MEDKIT_RADIUS = 14;
const MEDKIT_PICKUP_RADIUS = 30;

// ---- Пули ----
const BULLET_RADIUS = 4;
const PLAYER_BULLET_COLOR = 0xfacc15;
const ENEMY_BULLET_SPEED = 320;
const ENEMY_BULLET_COLOR = 0xf87171;

// ---- Прицел и автонаводка ----
const AIM_LENGTH = 70;
const AIM_COLOR = 0xfacc15;
const AIM_LOCK_COLOR = 0xf87171;
const AUTO_AIM_RANGE = 520;

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
const CARD_W = 360;
const CARD_H = 118;
const WEAPON_BUTTON_W = 220;
const WEAPON_BUTTON_H = 64;

// ---- Сохранения ----
const WALLET_KEY = 'ron.wallet';
const BEST_RUN_KEY = 'ron.bestRun';
const WEAPONS_OWNED_KEY = 'ron.weapons';
const WEAPON_SELECTED_KEY = 'ron.weapon';
const AUTO_AIM_KEY = 'ron.autoAim';
const UPGRADE_KEYS: Record<UpgradeId, string> = {
  armor: 'ron.up.armor',
  fireRate: 'ron.up.fireRate',
  damage: 'ron.up.damage',
  speed: 'ron.up.speed',
};

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

interface Medkit {
  sprite: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
}

interface ShopCard {
  upgradeId: UpgradeId;
  background: Phaser.GameObjects.Rectangle;
  pips: Phaser.GameObjects.Text;
  price: Phaser.GameObjects.Text;
}

interface ShopWeaponButton {
  weaponId: WeaponId;
  background: Phaser.GameObjects.Rectangle;
  status: Phaser.GameObjects.Text;
}

/**
 * Вертикальный срез: магазин с карточками, прокачка с сохранением,
 * арсенал, автонаводка, аптечки и пауза.
 *
 * Управление: WASD — движение, стрелки или курсор — прицел,
 * T — автонаводка, пробел — выстрел, Q — сменить оружие,
 * E — забрать заложника, P — пауза, R — рестарт.
 */
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private playerBody!: Phaser.Physics.Arcade.Body;

  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private hostageGroup!: Phaser.Physics.Arcade.Group;
  private hostages: Hostage[] = [];
  private medkits: Medkit[] = [];
  private bullets: Bullet[] = [];
  private levelWalls: Wall[] = [];
  private generated!: GeneratedLevel;

  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private aimKeys!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private fireKey!: Phaser.Input.Keyboard.Key;
  private rescueKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private pauseKey!: Phaser.Input.Keyboard.Key;
  private cycleKey!: Phaser.Input.Keyboard.Key;
  private autoAimKey!: Phaser.Input.Keyboard.Key;
  private shopKeys: Phaser.Input.Keyboard.Key[] = [];

  private hudText!: Phaser.GameObjects.Text;
  private pickupHint!: Phaser.GameObjects.Text;
  private phaseBanner!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private toastTimer?: Phaser.Time.TimerEvent;
  private aimLine!: Phaser.GameObjects.Line;
  private evacRect!: Phaser.Geom.Rectangle;

  private shopContainer!: Phaser.GameObjects.Container;
  private shopWalletText!: Phaser.GameObjects.Text;
  private shopMessageText!: Phaser.GameObjects.Text;
  private shopAutoAimText!: Phaser.GameObjects.Text;
  private shopCards: ShopCard[] = [];
  private shopWeaponButtons: ShopWeaponButton[] = [];
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
  private ownedWeapons: WeaponId[] = ['pistol'];
  private selectedWeaponId: WeaponId = 'pistol';
  private autoAim = true;
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

  private currentWeapon(): Weapon {
    return WEAPONS.find((weapon) => weapon.id === this.selectedWeaponId) ?? WEAPONS[0];
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
    this.medkits = [];
    this.shopCards = [];
    this.shopWeaponButtons = [];
    this.moneyEarned = 0;
    this.shopOpen = true;
    this.shopMessage = '';

    // Постоянный прогресс: кошелёк, рекорд, прокачка, арсенал, автонаводка
    this.wallet = this.readNumber(WALLET_KEY, 0);
    this.bestRun = this.readNumber(BEST_RUN_KEY, 0);
    this.upgradeLevels = {
      armor: this.readUpgradeLevel('armor'),
      fireRate: this.readUpgradeLevel('fireRate'),
      damage: this.readUpgradeLevel('damage'),
      speed: this.readUpgradeLevel('speed'),
    };
    this.ownedWeapons = this.readOwnedWeapons();
    const savedWeapon = this.readString(WEAPON_SELECTED_KEY, 'pistol');
    this.selectedWeaponId = this.ownedWeapons.includes(savedWeapon as WeaponId)
      ? (savedWeapon as WeaponId)
      : 'pistol';
    this.autoAim = this.readNumber(AUTO_AIM_KEY, 1) === 1;
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

    // Аптечки: статичные подбираемые объекты
    for (const spawn of this.generated.medkitSpawns) {
      const sprite = this.add
        .circle(spawn.x, spawn.y, MEDKIT_RADIUS, 0x16a34a)
        .setStrokeStyle(2, 0x86efac);
      const label = this.add
        .text(spawn.x, spawn.y, '+', {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '18px',
          fontStyle: 'bold',
          color: '#ffffff',
        })
        .setOrigin(0.5);
      this.medkits.push({ sprite, label });
    }

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
    this.cycleKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.autoAimKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.T);
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

    // Всплывающее сообщение (переключение автонаводки и оружия)
    this.toastText = this.add
      .text(this.scale.width / 2, 600, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#ffffff',
        backgroundColor: '#111827cc',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(16)
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

    if (Phaser.Input.Keyboard.JustDown(this.autoAimKey)) {
      this.toggleAutoAim();
    }
    if (Phaser.Input.Keyboard.JustDown(this.cycleKey)) {
      this.cycleWeapon();
    }

    this.movePlayer(time);
    this.updateAim();
    this.updatePhase();
    this.updateEnemies(time);
    this.updateHostages();
    this.updateMedkits();
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
    const panelW = 800;
    const panelH = 620;
    const container = this.add.container(0, 0).setScrollFactor(0).setDepth(30);

    const panel = this.add
      .rectangle(cx, this.scale.height / 2, panelW, panelH, SHOP_PANEL_COLOR, 0.97)
      .setStrokeStyle(2, 0x334155);
    const title = this.add
      .text(cx, 32, 'ПОДГОТОВКА К ОПЕРАЦИИ', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.shopWalletText = this.add
      .text(cx, 64, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);

    container.add([panel, title, this.shopWalletText]);

    // Карточки апгрейдов 2×2 (по 5 уровней)
    const cardCenters = [
      { x: cx - 185, y: 150 },
      { x: cx + 185, y: 150 },
      { x: cx - 185, y: 278 },
      { x: cx + 185, y: 278 },
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
      background.on('pointerover', () => background.setStrokeStyle(2, 0xfacc15));
      background.on('pointerout', () => this.renderShop());

      const icon = this.add
        .text(pos.x - 135, pos.y - 4, upgrade.icon, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '34px',
        })
        .setOrigin(0.5);

      const name = this.add.text(pos.x - 95, pos.y - 50, upgrade.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color: '#ffffff',
      });

      const description = this.add.text(pos.x - 95, pos.y - 26, upgrade.description, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#94a3b8',
      });

      const pips = this.add.text(pos.x - 95, pos.y - 2, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#facc15',
      });

      const price = this.add.text(pos.x - 95, pos.y + 22, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        color: '#4ade80',
      });

      const keyHint = this.add
        .text(pos.x + 165, pos.y - 52, `[${index + 1}]`, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '14px',
          color: '#64748b',
        })
        .setOrigin(1, 0);

      container.add([background, icon, name, description, pips, price, keyHint]);
      this.shopCards.push({ upgradeId: upgrade.id, background, pips, price });
    });

    // Арсенал: 3 кнопки оружия
    const weaponsLabel = this.add
      .text(cx, 345, 'ОРУЖИЕ — клик, чтобы купить или выбрать (Q в бою)', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#cbd5e1',
      })
      .setOrigin(0.5);
    container.add(weaponsLabel);

    const weaponCenters = [cx - 240, cx, cx + 240];
    WEAPONS.forEach((weapon, index) => {
      const x = weaponCenters[index];
      const y = 388;
      const background = this.add
        .rectangle(x, y, WEAPON_BUTTON_W, WEAPON_BUTTON_H, CARD_COLOR, 1)
        .setStrokeStyle(2, CARD_STROKE)
        .setInteractive({ useHandCursor: true });
      background.on('pointerdown', () => {
        if (this.shopOpen) this.tryBuyWeapon(weapon.id);
      });
      background.on('pointerover', () => background.setStrokeStyle(2, 0xfacc15));
      background.on('pointerout', () => this.renderShop());

      const icon = this.add
        .text(x - 85, y, weapon.icon, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '24px',
        })
        .setOrigin(0.5);

      const name = this.add.text(x - 55, y - 24, weapon.name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffffff',
      });

      const status = this.add.text(x - 55, y + 1, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '12px',
        color: '#4ade80',
      });

      container.add([background, icon, name, status]);
      this.shopWeaponButtons.push({ weaponId: weapon.id, background, status });
    });

    this.shopMessageText = this.add
      .text(cx, 442, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        color: '#fca5a5',
      })
      .setOrigin(0.5);
    container.add(this.shopMessageText);

    const startButton = this.add
      .rectangle(cx, 488, 400, 46, 0x22c55e, 1)
      .setStrokeStyle(2, 0x16a34a)
      .setInteractive({ useHandCursor: true });
    startButton.on('pointerdown', () => {
      if (this.shopOpen) this.startMission();
    });
    startButton.on('pointerover', () => startButton.setFillStyle(0x4ade80));
    startButton.on('pointerout', () => startButton.setFillStyle(0x22c55e));
    const startLabel = this.add
      .text(cx, 488, 'НАЧАТЬ ОПЕРАЦИЮ (ПРОБЕЛ)', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color: '#052e16',
      })
      .setOrigin(0.5);

    const controls = this.add
      .text(
        cx,
        542,
        'Клик по карточке = покупка · 1–4 апгрейды · WASD движение · стрелки прицел · Q оружие · T автонаводка · E заложник · P пауза',
        {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '12px',
          color: '#94a3b8',
        },
      )
      .setOrigin(0.5);

    this.shopAutoAimText = this.add
      .text(cx, 576, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '15px',
        color: '#facc15',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.shopAutoAimText.on('pointerdown', () => {
      if (this.shopOpen) this.toggleAutoAim();
    });

    container.add([startButton, startLabel, controls, this.shopAutoAimText]);

    this.shopContainer = container;
    this.renderShop();
  }

  private updateShop(): void {
    this.shopKeys.forEach((key, index) => {
      if (Phaser.Input.Keyboard.JustDown(key)) {
        this.tryBuy(UPGRADES[index].id);
      }
    });

    if (Phaser.Input.Keyboard.JustDown(this.autoAimKey)) {
      this.toggleAutoAim();
    }

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
    this.writeNumber(UPGRADE_KEYS[upgradeId], level + 1);
    this.applyStats();
    this.shopMessage = `${upgrade.name}: уровень ${level + 1} (сохранится)`;
    this.renderShop();
  }

  private tryBuyWeapon(weaponId: WeaponId): void {
    const weapon = WEAPONS.find((item) => item.id === weaponId);
    if (!weapon) return;

    if (this.ownedWeapons.includes(weaponId)) {
      this.selectWeapon(weaponId);
      return;
    }

    if (this.wallet < weapon.price) {
      this.shopMessage = 'Недостаточно денег';
      return;
    }

    this.wallet -= weapon.price;
    this.writeNumber(WALLET_KEY, this.wallet);
    this.ownedWeapons = [...this.ownedWeapons, weaponId];
    this.writeString(WEAPONS_OWNED_KEY, JSON.stringify(this.ownedWeapons));
    this.selectWeapon(weaponId);
    this.shopMessage = `Куплено навсегда: ${weapon.name}`;
  }

  private selectWeapon(weaponId: WeaponId): void {
    this.selectedWeaponId = weaponId;
    this.writeString(WEAPON_SELECTED_KEY, weaponId);
    this.shopMessage = `Выбрано: ${this.currentWeapon().name}`;
    this.renderShop();
  }

  private renderShop(): void {
    this.shopWalletText.setText(
      `Кошелёк: ${this.wallet}₽   ·   Рекорд миссии: ${this.bestRun}₽   ·   Прогресс сохраняется`,
    );
    this.shopMessageText.setText(this.shopMessage);
    this.shopAutoAimText.setText(
      `Автонаводка: ${this.autoAim ? 'ВКЛ' : 'ВЫКЛ'} — нажми T или кликни здесь`,
    );

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

    for (const button of this.shopWeaponButtons) {
      const weapon = WEAPONS.find((item) => item.id === button.weaponId);
      if (!weapon) continue;

      const owned = this.ownedWeapons.includes(weapon.id);
      const selected = this.selectedWeaponId === weapon.id;

      if (selected) {
        button.status.setText('ВЫБРАНО').setColor('#4ade80');
        button.background.setStrokeStyle(2, 0x22c55e);
      } else if (owned) {
        button.status.setText('ВЫБРАТЬ').setColor('#cbd5e1');
        button.background.setStrokeStyle(2, CARD_STROKE);
      } else {
        button.status
          .setText(`${weapon.price}₽`)
          .setColor(this.wallet >= weapon.price ? '#4ade80' : '#f87171');
        button.background.setStrokeStyle(2, CARD_STROKE);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Пауза и уведомления
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

  private showToast(message: string): void {
    this.toastText.setText(message).setVisible(true);
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(1400, () => this.toastText.setVisible(false));
  }

  private toggleAutoAim(): void {
    this.autoAim = !this.autoAim;
    this.writeNumber(AUTO_AIM_KEY, this.autoAim ? 1 : 0);
    this.showToast(`Автонаводка: ${this.autoAim ? 'ВКЛ' : 'ВЫКЛ'}`);
    this.updateHud();
    this.renderShop();
  }

  private cycleWeapon(): void {
    const owned = this.ownedWeapons;
    const index = owned.indexOf(this.selectedWeaponId);
    this.selectedWeaponId = owned[(index + 1) % owned.length];
    this.writeString(WEAPON_SELECTED_KEY, this.selectedWeaponId);
    this.showToast(`Оружие: ${this.currentWeapon().name}`);
    this.updateHud();
  }

  // ---------------------------------------------------------------------------
  // Игровой цикл
  // ---------------------------------------------------------------------------

  private applyStats(): void {
    this.maxHp = PLAYER_MAX_HP + this.upgradeLevels.armor * ARMOR_PER_LEVEL;
    this.hp = this.maxHp;
  }

  private playerDamage(): number {
    return this.currentWeapon().damage + this.upgradeLevels.damage * DAMAGE_PER_LEVEL;
  }

  private playerFireCooldownMs(): number {
    return (
      this.currentWeapon().cooldownMs *
      (1 - this.upgradeLevels.fireRate * FIRE_RATE_PER_LEVEL)
    );
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

    // Выстрел: пробел, пули летят по направлению прицела
    if (
      Phaser.Input.Keyboard.JustDown(this.fireKey) &&
      time - this.lastPlayerShot >= this.playerFireCooldownMs()
    ) {
      this.shoot();
      this.lastPlayerShot = time;
    }
  }

  private shoot(): void {
    const weapon = this.currentWeapon();
    for (let i = 0; i < weapon.pellets; i++) {
      const offset = (i - (weapon.pellets - 1) / 2) * weapon.spreadRad;
      this.spawnBullet(
        this.player.x,
        this.player.y,
        this.aimAngle + offset,
        weapon.bulletSpeed,
        true,
      );
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

  /**
   * Прицел: стрелки задают направление вручную; если автонаводка включена
   * и виден враг — линия сама наводится на него (красная); иначе — курсор.
   */
  private updateAim(): void {
    const pointer = this.input.activePointer;
    let ax = 0;
    let ay = 0;

    if (this.aimKeys.left.isDown) ax -= 1;
    if (this.aimKeys.right.isDown) ax += 1;
    if (this.aimKeys.up.isDown) ay -= 1;
    if (this.aimKeys.down.isDown) ay += 1;

    let autoTarget: Phaser.GameObjects.Rectangle | null = null;

    if (ax !== 0 || ay !== 0) {
      this.aimAngle = Math.atan2(ay, ax);
    } else {
      if (this.autoAim) {
        autoTarget = this.findAutoAimTarget();
      }
      if (autoTarget) {
        this.aimAngle = Math.atan2(
          autoTarget.y - this.player.y,
          autoTarget.x - this.player.x,
        );
      } else if (
        pointer.worldX !== this.lastPointerX ||
        pointer.worldY !== this.lastPointerY
      ) {
        this.aimAngle = Math.atan2(pointer.worldY - this.player.y, pointer.worldX - this.player.x);
      }
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
    this.aimLine.setStrokeStyle(
      2,
      autoTarget ? AIM_LOCK_COLOR : AIM_COLOR,
      autoTarget ? 0.9 : 0.55,
    );
  }

  private findAutoAimTarget(): Phaser.GameObjects.Rectangle | null {
    let best: Phaser.GameObjects.Rectangle | null = null;
    let bestDist = AUTO_AIM_RANGE;

    for (const enemy of this.enemyGroup.getChildren() as Phaser.GameObjects.Rectangle[]) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x,
        this.player.y,
        enemy.x,
        enemy.y,
      );
      if (dist < bestDist && this.canSee(this.player.x, this.player.y, enemy.x, enemy.y)) {
        best = enemy;
        bestDist = dist;
      }
    }

    return best;
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

  /** Подбор аптечки при приближении: +30 HP, но не выше максимума. */
  private updateMedkits(): void {
    for (let i = this.medkits.length - 1; i >= 0; i--) {
      const medkit = this.medkits[i];
      const dist = Phaser.Math.Distance.Between(
        medkit.sprite.x,
        medkit.sprite.y,
        this.player.x,
        this.player.y,
      );
      if (dist > MEDKIT_PICKUP_RADIUS) continue;
      if (this.hp >= this.maxHp) continue;

      const healed = Math.min(MEDKIT_HEAL, this.maxHp - this.hp);
      this.hp += healed;
      this.showFloatingText(medkit.sprite.x, medkit.sprite.y, `+${healed} HP`);

      medkit.sprite.destroy();
      medkit.label.destroy();
      this.medkits.splice(i, 1);
    }
  }

  private showFloatingText(x: number, y: number, message: string): void {
    const text = this.add
      .text(x, y - 20, message, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#86efac',
      })
      .setOrigin(0.5)
      .setDepth(12);

    this.tweens.add({
      targets: text,
      y: y - 60,
      alpha: 0,
      duration: 800,
      onComplete: () => text.destroy(),
    });
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

  private readString(key: string, fallback: string): string {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  }

  private writeString(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // localStorage недоступен — играем без сохранений
    }
  }

  private readUpgradeLevel(upgradeId: UpgradeId): number {
    const upgrade = UPGRADES.find((item) => item.id === upgradeId);
    const maxLevel = upgrade ? upgrade.maxLevel : 0;
    return Phaser.Math.Clamp(this.readNumber(UPGRADE_KEYS[upgradeId], 0), 0, maxLevel);
  }

  private readOwnedWeapons(): WeaponId[] {
    try {
      const raw = window.localStorage.getItem(WEAPONS_OWNED_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return ['pistol'];

      const owned = parsed.filter((id): id is WeaponId =>
        WEAPONS.some((weapon) => weapon.id === id),
      );
      return owned.includes('pistol') ? owned : ['pistol', ...owned];
    } catch {
      return ['pistol'];
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
        `Оружие: ${this.currentWeapon().name} (Q)`,
        `Автонаводка: ${this.autoAim ? 'ВКЛ' : 'ВЫКЛ'} (T)`,
      ].join('\n'),
    );
  }
}
