// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "../types/Side.sol";
import "../governance/Governable.sol";
import "../core/interfaces/IMarketDescriptor.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockRouter is Governable {
    uint160 private tradePriceX96;
    uint128 private acceptableMinMargin = 100;

    function setTradePriceX96(uint160 _tradePriceX96) external {
        tradePriceX96 = _tradePriceX96;
    }

    function setAcceptableMinMargin(uint128 _acceptableMinMargin) external {
        acceptableMinMargin = _acceptableMinMargin;
    }

    function pluginTransfer(IERC20 _token, address _from, address _to, uint256 _amount) external {
        SafeERC20.safeTransferFrom(_token, _from, _to, _amount);
    }

    function pluginLiquidateLiquidityPosition(
        IMarketDescriptor _market,
        address _account,
        address _feeReceiver
    ) external {}

    function pluginLiquidatePosition(
        IMarketDescriptor _market,
        address _account,
        Side _side,
        address _feeReceiver
    ) external {}

    function pluginIncreaseLiquidityPosition(
        IERC20 /*_market*/,
        address /*_account*/,
        uint128 /*_marginDelta*/,
        uint128 /*_liquidityDelta*/
    ) external view returns (uint128) {
        return acceptableMinMargin;
    }

    function pluginDecreaseLiquidityPosition(
        IERC20 /*_market*/,
        address /*_account*/,
        uint128 /*_marginDelta*/,
        uint128 /*_liquidityDelta*/,
        address /*_receiver*/
    ) external view returns (uint128) {
        return acceptableMinMargin;
    }

    function pluginIncreasePosition(
        IERC20 /*_market*/,
        address /*_account*/,
        Side /*_side*/,
        uint128 /*_marginDelta*/,
        uint128 /*_sizeDelta*/
    ) external view returns (uint160) {
        return (tradePriceX96);
    }

    function pluginDecreasePosition(
        IERC20 /*_market*/,
        address /*_account*/,
        Side /*_side*/,
        uint128 /*_marginDelta*/,
        uint128 /*_sizeDelta*/,
        address /*_receiver*/
    ) external view returns (uint160) {
        return (tradePriceX96);
    }

    function pluginSampleAndAdjustFundingRate(IMarketDescriptor /*_market*/) external {}

    function pluginClosePositionByLiquidator(
        IMarketDescriptor /*_market*/,
        address /*_account*/,
        Side /*_side*/,
        uint128 /*_sizeDelta*/,
        address /*_receiver*/
    ) external pure returns (uint160) {
        return 0;
    }
}

/// @notice This is a mocked router that will drain all the available gas.
/// It's used to simulate a maliciously fabricated market address passed in by the user
/// which will drain the gas
contract GasDrainingMockRouter {
    function drainGas() internal pure {
        while (true) {}
    }

    function pluginTransfer(IERC20 _token, address _from, address _to, uint256 _amount) external {
        SafeERC20.safeTransferFrom(_token, _from, _to, _amount);
    }

    function pluginIncreaseLiquidityPosition(
        IERC20 /*_market*/,
        address /*_account*/,
        uint128 /*_marginDelta*/,
        uint128 /*_liquidityDelta*/
    ) external pure returns (uint256) {
        drainGas();
        return 0;
    }

    function pluginDecreaseLiquidityPosition(
        IERC20 /*_market*/,
        address /*_account*/,
        uint128 /*_marginDelta*/,
        uint128 /*_liquidityDelta*/,
        address /*_receiver*/
    ) external pure returns (uint128) {
        drainGas();
        return 0;
    }

    function pluginIncreasePosition(
        IERC20 /*_market*/,
        address /*_account*/,
        Side /*_side*/,
        uint128 /*_marginDelta*/,
        uint128 /*_sizeDelta*/
    ) external pure returns (uint160) {
        drainGas();
        return 0;
    }

    function pluginDecreasePosition(
        IERC20 /*_market*/,
        address /*_account*/,
        Side /*_side*/,
        uint128 /*_marginDelta*/,
        uint128 /*_sizeDelta*/,
        address /*_receiver*/
    ) external pure returns (uint160) {
        drainGas();
        return 0;
    }

    function pluginSampleAndAdjustFundingRate(IMarketDescriptor /*_market*/) external pure {
        drainGas();
    }

    function pluginClosePositionByLiquidator(
        IMarketDescriptor /*_market*/,
        address /*_account*/,
        Side /*_side*/,
        uint128 /*_sizeDelta*/,
        address /*_receiver*/
    ) external pure returns (uint160) {
        drainGas();
        return 0;
    }
}
