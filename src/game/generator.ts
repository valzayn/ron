import { BUILDING } from './level';
import type { Point, PatrolRoute, Wall } from './level';

const WALL_THICKNESS = 32;
const DOOR_WIDTH = 72;
const ENTRANCE_WIDTH = 80;
const ROOM_MARGIN = 50;
const COLS = 3;
const ROWS = 2;
const ENEMY_COUNT = 4;
const MAX_HOSTAGES = 3;

export interface GeneratedLevel {
  walls: Wall[];
  enemyPatrols: PatrolRoute[];
  hostageSpawns: Point[];
  entrance: { x: number; y: number; width: number };
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

/** Отрезок стены с дверным проёмом (гарантирует проходимость). */
function wallWithDoor(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  horizontal: boolean,
): Wall[] {
  if (horizontal) {
    const doorX = randInt(x1 + 40, x2 - 40 - DOOR_WIDTH);
    return [
      { x: x1, y: y1, width: doorX - x1, height: WALL_THICKNESS },
      { x: doorX + DOOR_WIDTH, y: y1, width: x2 - doorX - DOOR_WIDTH, height: WALL_THICKNESS },
    ];
  }
  const doorY = randInt(y1 + 40, y2 - 40 - DOOR_WIDTH);
  return [
    { x: x1, y: y1, width: WALL_THICKNESS, height: doorY - y1 },
    { x: x1, y: doorY + DOOR_WIDTH, width: WALL_THICKNESS, height: y2 - doorY - DOOR_WIDTH },
  ];
}

/**
 * Процедурная генерация планировки здания (по образцу PLATFORM JUMP).
 *
 * Сетка COLS×ROWS комнат; между соседними комнатами всегда есть дверь,
 * поэтому здание гарантированно связно. Вход с улицы — в случайной
 * комнате нижнего ряда. Патрули и заложники (1–3) раскидываются
 * по случайным комнатам. Вызывается при каждом запуске сцены,
 * поэтому каждый рестарт даёт новое здание.
 */
export function generateLevel(): GeneratedLevel {
  const left = BUILDING.x;
  const top = BUILDING.y;
  const right = BUILDING.x + BUILDING.width;
  const bottom = BUILDING.y + BUILDING.height;

  const xs: number[] = [];
  for (let i = 0; i <= COLS; i++) {
    xs.push(Math.round(left + (i * BUILDING.width) / COLS));
  }
  const ys: number[] = [];
  for (let i = 0; i <= ROWS; i++) {
    ys.push(Math.round(top + (i * BUILDING.height) / ROWS));
  }

  const walls: Wall[] = [];

  // Внешние стены (северная, западная, восточная)
  walls.push({ x: left, y: top - WALL_THICKNESS, width: right - left, height: WALL_THICKNESS });
  walls.push({
    x: left - WALL_THICKNESS,
    y: top - WALL_THICKNESS,
    width: WALL_THICKNESS,
    height: bottom - top + 2 * WALL_THICKNESS,
  });
  walls.push({
    x: right,
    y: top - WALL_THICKNESS,
    width: WALL_THICKNESS,
    height: bottom - top + 2 * WALL_THICKNESS,
  });

  // Нижняя стена с проёмом входа в случайной комнате нижнего ряда
  const entranceCol = randInt(0, COLS - 1);
  const entranceX = randInt(xs[entranceCol] + 60, xs[entranceCol + 1] - 60 - ENTRANCE_WIDTH);
  walls.push({ x: left, y: bottom, width: entranceX - left, height: WALL_THICKNESS });
  walls.push({
    x: entranceX + ENTRANCE_WIDTH,
    y: bottom,
    width: right - entranceX - ENTRANCE_WIDTH,
    height: WALL_THICKNESS,
  });

  // Горизонтальная стена между рядами: дверь в каждой колонне
  const midY = ys[1];
  for (let c = 0; c < COLS; c++) {
    walls.push(...wallWithDoor(xs[c], midY, xs[c + 1], midY, true));
  }

  // Вертикальные стены между колоннами: отдельная дверь в каждом ряду
  for (let k = 1; k < COLS; k++) {
    walls.push(...wallWithDoor(xs[k], top, xs[k], midY, false));
    walls.push(...wallWithDoor(xs[k], midY + WALL_THICKNESS, xs[k], bottom, false));
  }

  // Комнаты в случайном порядке — из них выбираются комнаты патрулей и заложников
  const cells: Array<{ col: number; row: number }> = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      cells.push({ col: c, row: r });
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }

  const enemyPatrols: PatrolRoute[] = [];
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const cell = cells[i % cells.length];
    const x1 = xs[cell.col] + ROOM_MARGIN;
    const x2 = xs[cell.col + 1] - ROOM_MARGIN;
    const y1 = ys[cell.row] + ROOM_MARGIN;
    const y2 = ys[cell.row + 1] - ROOM_MARGIN;
    if (Math.random() < 0.5) {
      const y = randInt(y1, y2);
      enemyPatrols.push({ sx: x1, sy: y, ex: x2, ey: y });
    } else {
      const x = randInt(x1, x2);
      enemyPatrols.push({ sx: x, sy: y1, ex: x, ey: y2 });
    }
  }

  const hostageSpawns: Point[] = [];
  const hostageCount = randInt(1, MAX_HOSTAGES);
  for (let i = 0; i < hostageCount; i++) {
    const cell = cells[(ENEMY_COUNT + i) % cells.length];
    hostageSpawns.push({
      x: randInt(xs[cell.col] + 70, xs[cell.col + 1] - 70),
      y: randInt(ys[cell.row] + 70, ys[cell.row + 1] - 70),
    });
  }

  return {
    walls,
    enemyPatrols,
    hostageSpawns,
    entrance: { x: entranceX, y: bottom, width: ENTRANCE_WIDTH },
  };
}