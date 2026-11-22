import type { TerritoryState, UnitCounts, UnitType } from "@hegemonia/shared";

export const UNIT_TYPES = [
  "infantry",
  "tank",
  "artillery",
  "aircraft",
  "navy",
] as const satisfies readonly UnitType[];

export function emptyUnitCounts(): UnitCounts {
  return { infantry: 0, tank: 0, artillery: 0, aircraft: 0, navy: 0 };
}

export function singleUnitCount(unitType: UnitType, quantity = 1): UnitCounts {
  return { ...emptyUnitCounts(), [unitType]: quantity };
}

export function totalUnits(units: UnitCounts): number {
  return UNIT_TYPES.reduce((total, unitType) => total + units[unitType], 0);
}

function reconcileUnits(
  units: UnitCounts | undefined,
  legacyTotal: number
): UnitCounts {
  const targetTotal = Math.max(0, legacyTotal);
  if (!units) return singleUnitCount("infantry", targetTotal);

  const result = { ...units };
  const difference = targetTotal - totalUnits(result);
  if (difference > 0) result.infantry += difference;
  if (difference < 0) return removeCasualties(result, -difference).remaining;
  return result;
}

export function getTerritoryUnits(territory: TerritoryState): UnitCounts {
  return reconcileUnits(territory.units, territory.armies);
}

export function getMovedInUnits(territory: TerritoryState): UnitCounts {
  return reconcileUnits(territory.movedInUnits, territory.movedInArmies);
}

export function setTerritoryUnits(territory: TerritoryState, units: UnitCounts): void {
  territory.units = { ...units };
  territory.armies = totalUnits(units);
}

export function setMovedInUnits(territory: TerritoryState, units: UnitCounts): void {
  territory.movedInUnits = { ...units };
  territory.movedInArmies = totalUnits(units);
}

export function addUnits(base: UnitCounts, added: UnitCounts): UnitCounts {
  const result = { ...base };
  for (const unitType of UNIT_TYPES) result[unitType] += added[unitType];
  return result;
}

export function canSubtractUnits(base: UnitCounts, removed: UnitCounts): boolean {
  return UNIT_TYPES.every((unitType) => removed[unitType] <= base[unitType]);
}

export function subtractUnits(base: UnitCounts, removed: UnitCounts): UnitCounts {
  const result = { ...base };
  for (const unitType of UNIT_TYPES) result[unitType] -= removed[unitType];
  return result;
}

export function scaleUnits(units: UnitCounts, quantity: number): UnitCounts {
  const result = { ...units };
  for (const unitType of UNIT_TYPES) result[unitType] *= quantity;
  return result;
}

export function selectUnits(available: UnitCounts, quantity: number): UnitCounts {
  const selected = emptyUnitCounts();
  let remaining = quantity;
  for (const unitType of UNIT_TYPES) {
    selected[unitType] = Math.min(available[unitType], remaining);
    remaining -= selected[unitType];
  }
  return selected;
}

export function removeCasualties(
  units: UnitCounts,
  quantity: number
): { remaining: UnitCounts; losses: UnitCounts } {
  const losses = selectUnits(units, quantity);
  return { remaining: subtractUnits(units, losses), losses };
}

/**
 * HEGEM-178: Removes casualties where each Tank requires 2 damage points (2 HP)
 * to be destroyed once damage reaches the armor column; 1 odd residual point is
 * absorbed by tank armor without destroying a unit.
 */
export function removeCasualtiesWithArmorAbsorption(
  units: UnitCounts,
  damagePoints: number
): { remaining: UnitCounts; losses: UnitCounts; absorbedDamage: number } {
  let rem = Math.max(0, Math.floor(damagePoints));
  const losses = emptyUnitCounts();

  const infLoss = Math.min(units.infantry, rem);
  losses.infantry = infLoss;
  rem -= infLoss;

  if (rem > 0 && units.tank > 0) {
    const tankKillable = Math.min(units.tank, Math.floor(rem / 2));
    losses.tank = tankKillable;
    rem -= tankKillable * 2;
  }

  let absorbedDamage = 0;
  if (rem === 1 && units.tank - losses.tank > 0) {
    absorbedDamage = 1;
    rem = 0;
  }

  for (const unitType of ["artillery", "aircraft", "navy"] as const) {
    if (rem <= 0) break;
    const loss = Math.min(units[unitType], rem);
    losses[unitType] = loss;
    rem -= loss;
  }

  return {
    remaining: subtractUnits(units, losses),
    losses,
    absorbedDamage,
  };
}
