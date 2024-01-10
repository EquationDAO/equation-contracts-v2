import Decimal from "decimal.js";
import {BigNumberish, toBigInt} from "ethers";

export const Q32 = 1n << 32n;
export const Q64 = 1n << 64n;
export const Q96 = 1n << 96n;

export const BASIS_POINTS_DIVISOR = 100_000_000n;

export const DECIMALS_18: number = 18;
export const DECIMALS_6: number = 6;

export const PREMIUM_RATE_AVG_DENOMINATOR: bigint = 8n * 259560n;
export const PREMIUM_RATE_CLAMP_BOUNDARY_X96: bigint = 4951760157141521099596497n;

export const ADJUST_FUNDING_RATE_INTERVAL = 3600n;
export const SAMPLE_PREMIUM_RATE_INTERVAL = 5n;
export const REQUIRED_SAMPLE_COUNT = ADJUST_FUNDING_RATE_INTERVAL / SAMPLE_PREMIUM_RATE_INTERVAL;

export const VERTEX_NUM: bigint = 10n;
export const LATEST_VERTEX = VERTEX_NUM - 1n;

export type Side = number;
export const SIDE_LONG: Side = 1;
export const SIDE_SHORT: Side = 2;

export function isLongSide(side: Side) {
    return side === SIDE_LONG;
}

export function isShortSide(side: Side) {
    return side === SIDE_SHORT;
}

export function flipSide(side: Side) {
    if (side === SIDE_LONG) {
        return SIDE_SHORT;
    } else if (side === SIDE_SHORT) {
        return SIDE_LONG;
    }
    return side;
}

export enum Rounding {
    Down,
    Up,
}

export function mulDiv(a: BigNumberish, b: BigNumberish, c: BigNumberish, rounding?: Rounding): bigint {
    const mul = toBigInt(a) * toBigInt(b);
    let ans = mul / toBigInt(c);
    if (rounding != undefined && rounding == Rounding.Up) {
        if (ans * toBigInt(c) != mul) {
            ans = ans + 1n;
        }
    }
    return ans;
}

export function toX96(value: string): bigint {
    return BigInt(new Decimal(value).mul(new Decimal(2).pow(96)).toFixed(0));
}

export function toPriceX96(price: string, tokenDecimals: number, usdDecimals: number): bigint {
    return BigInt(
        new Decimal(price)
            .mul(new Decimal(10).pow(usdDecimals))
            .div(new Decimal(10).pow(tokenDecimals))
            .mul(new Decimal(2).pow(96))
            .toFixed(0),
    );
}
