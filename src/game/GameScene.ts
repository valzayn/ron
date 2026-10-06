import Phaser from 'phaser';
import {
  BUILDING,
  ENEMY_PATROLS,
  EVAC_ZONE,
  HOSTAGE_SPAWNS,
  PLAYER_SPAWN,
  WALLS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './level';

// ---- Игрок ----
const PLAYER_SPEED = 260;
const PLAYER_SIZE = 36;
const PLAYER_COLOR = 0x38bdf8;
const PLAYER_MAX_HP = 100;
const PLAYER_INVULN_MS = 600;

// ---- Враги ----
const ENEMY_SIZE = 32;
const ENEMY_COLOR = 0xef4444;
const ENEMY_SPEED = 60;
const ENEMY_AGGRO_RANGE = 300;
const ENEMY_FIRE_COOLDOWN_MS = 900;
const ENEMY_DAMAGE = 25;

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

// ---- Оформление ----
const WALL_COLOR = 0x64748b;
const FLOOR_COLOR = 0x1e293b;
const EVAC_COLOR = 0x22c55e;

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

/**
 * Этап «Враги, заложники, стрельба».
 *
 * Пробел — выстрел в сторону курсора, E — забрать заложника,
 * R — рестарт. Враги патрулируют комнаты и стреляют в игрока.
 * Цель — вывести всех заложников в зону эвакуации на улице.
 */
export class GameScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private playerBody!: Phaser.Physics.Arcade.Body;

  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private hostageGroup!: Phaser.Physics.Arcade.Group;
  private hostages: Hostage[] = [];
  private bullets: Bullet[] = [];

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private fireKey!: Phaser.Input.Keyboard.Key;
  private rescueKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;

  private hudText!: Phaser.GameObjects.Text;
  private pickupHint!: Phaser.GameObjects.Text;
  private evacRect!: Phaser.Geom.Rectangle;

  private hp = PLAYER_MAX_HP;
  private lastPlayerShot = 0;
  private invulnUntil = 0;
  private enemiesKilled = 0;
  private hostagesEvacuated = 0;
  private gameOver = false;

  constructor() {
    super('GameScene');
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Пол здания (рисуется под стенами)
    this.add
      .rectangle(BUILDING.x, BUILDING.y, BUILDING.width, BUILDING.height, FLOOR_COLOR)
      .setOrigin(0);

    // Стены как статические тела
    this.walls = this.physics.add.staticGroup();
    for (const wall of WALLS) {
      const rect = this.add
        .rectangle(wall.x, wall.y, wall.width, wall.height, WALL_COLOR)
        .setOrigin(0);
      this.walls.add(rect);
    }

    // Игрок — динамическое физическое тело
    this.player = this.add.rectangle(
      PLAYER_SPAWN.x,
      PLAYER_SPAWN.y,
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
    for (const patrol of ENEMY_PATROLS) {
      const enemy = this.add.rectangle(patrol.sx, patrol.sy, ENEMY_SIZE, ENEMY_SIZE, ENEMY_COLOR);
      enemy.setData('route', patrol);
      enemy.setData('target', { x: patrol.ex, y: patrol.ey });
      enemy.setData('lastShot', 0);
      this.enemyGroup.add(enemy);
    }
    this.physics.add.collider(this.enemyGroup, this.walls);
    this.physics.add.collider(this.player, this.enemyGroup);

    // Заложники: круги с динамическим телом
    this.hostageGroup = this.physics.add.group();
    for (const spawn of HOSTAGE_SPAWNS) {
      const sprite = this.add.circle(spawn.x, spawn.y, HOSTAGE_SIZE, HOSTAGE_COLOR);
      this.hostageGroup.add(sprite);
      this.hostages.push({ sprite, rescued: false });
    }
    this.physics.add.collider(this.hostageGroup, this.walls);
    this.physics.add.collider(this.hostageGroup, this.enemyGroup);

    // Зона эвакуации на улице у входа
    this.evacRect = new Phaser.Geom.Rectangle(EVAC_ZONE.x, EVAC_ZONE.y, EVAC_ZONE.width, EVAC_ZONE.height);
    this.add
      .rectangle(EVAC_ZONE.x, EVAC_ZONE.y, EVAC_ZONE.width, EVAC_ZONE.height, EVAC_COLOR, 0.12)
      .setOrigin(0)
      .setStrokeStyle(2, EVAC_COLOR, 0.9);
    this.add
      .text(EVAC_ZONE.x + EVAC_ZONE.width / 2, EVAC_ZONE.y - 10, 'ЭВАКУАЦИЯ', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '14px',
        color: '#bbf7d0',
      })
      .setOrigin(0.5, 1);

    // Управление: стрелки/WASD — движение, пробел — огонь, E — заложник, R — рестарт
    if (!this.input.keyboard) {
      throw new Error('Keyboard input is unavailable.');
    }
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
    this.fireKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.rescueKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);

    // Камера следует за игроком по всему миру
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

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

    if (Phaser.Input.Keyboard.JustDown(this.restartKey)) {
      this.scene.restart();
      return;
    }

    this.movePlayer(time);
    this.updateEnemies(time);
    this.updateHostages();
    this.updatePickupHint();
    this.updateBullets(seconds);
    this.checkEvacuation();
    this.updateHud();
  }

  private movePlayer(time: number): void {
    let dx = 0;
    let dy = 0;

    if (this.cursors.left.isDown || this.wasd.left.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) dx += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) dy -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) dy += 1;

    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      this.playerBody.setVelocity((dx / length) * PLAYER_SPEED, (dy / length) * PLAYER_SPEED);
    } else {
      this.playerBody.setVelocity(0, 0);
    }

    // Выстрел: пробел, пуля летит в сторону курсора
    if (
      Phaser.Input.Keyboard.JustDown(this.fireKey) &&
      time - this.lastPlayerShot >= PLAYER_SHOOT_COOLDOWN_MS
    ) {
      this.shootAtPointer();
      this.lastPlayerShot = time;
    }
  }

  private shootAtPointer(): void {
    const pointer = this.input.activePointer;
    const angle = Math.atan2(pointer.worldY - this.player.y, pointer.worldX - this.player.x);
    this.spawnBullet(this.player.x, this.player.y, angle, PLAYER_BULLET_SPEED, true);
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

  private updateEnemies(time: number): void {
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
        body.setVelocity(Math.cos(angle) * ENEMY_SPEED, Math.sin(angle) * ENEMY_SPEED);
      }

      // Стрельба по игроку: рядом и есть прямая видимость
      const distToPlayer = Phaser.Math.Distance.Between(
        enemy.x,
        enemy.y,
        this.player.x,
        this.player.y,
      );
      if (
        distToPlayer <= ENEMY_AGGRO_RANGE &&
        this.canSee(enemy.x, enemy.y, this.player.x, this.player.y) &&
        time - (enemy.getData('lastShot') as number) >= ENEMY_FIRE_COOLDOWN_MS
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
            enemy.destroy();
            this.enemiesKilled += 1;
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
      }
    }

    if (this.hostagesEvacuated >= HOSTAGE_SPAWNS.length) {
      this.endGame('win');
    }
  }

  private endGame(result: 'win' | 'defeat'): void {
    this.gameOver = true;
    this.playerBody.setVelocity(0, 0);
    this.pickupHint.setVisible(false);

    const title = result === 'win' ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ';
    const subtitle =
      result === 'win'
        ? 'Все заложники эвакуированы.'
        : 'Оперативник выбыл. Попробуй ещё раз.';
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
      .text(cx, cy + 30, `${subtitle} Нажми R для рестарта.`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '18px',
        color: '#cbd5e1',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(21);
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
    return WALLS.some(
      (w) => x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height,
    );
  }

  private updateHud(): void {
    this.hudText.setText(
      [
        `HP: ${this.hp}`,
        `Заложники: ${this.hostagesEvacuated}/${HOSTAGE_SPAWNS.length}`,
        `Враги: ${this.enemiesKilled}/${ENEMY_PATROLS.length}`,
      ].join('\n'),
    );
  }
}
