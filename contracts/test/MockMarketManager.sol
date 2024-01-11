// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.23;

import "../types/Side.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../core/interfaces/IMarketLiquidityPosition.sol";
import "../../contracts/oracle/interfaces/IPriceFeed.sol";
import "../../contracts/core/interfaces/IConfigurable.sol";
import "../../contracts/core/interfaces/IMarketPosition.sol";
import "../../contracts/core/interfaces/IMarketLiquidityPosition.sol";

contract MockMarketManager {
    uint160 private longMarketPriceX96;
    uint160 private shortMarketPriceX96;
    IPriceFeed public priceFeed;
    mapping(IMarketDescriptor market => mapping(address account => IMarketLiquidityPosition.LiquidityPosition))
        public liquidityPositions;
    mapping(IMarketDescriptor market => mapping(address account => mapping(Side side => IMarketPosition.Position)))
        public positions;
    IMarketPosition.Position private position;
    IConfigurable.MarketFeeRateConfig private marketFeeRateConfig;
    IConfigurable.MarketBaseConfig private marketBaseConfig;
    IMarketPosition.GlobalPosition private globalPosition;

    function setPriceFeed(IPriceFeed _priceFeed) external {
        priceFeed = _priceFeed;
    }

    function setMarketPriceX96(uint160 _longMarketPriceX96, uint160 _shortMarketPriceX96) external {
        longMarketPriceX96 = _longMarketPriceX96;
        shortMarketPriceX96 = _shortMarketPriceX96;
    }

    function marketPriceX96s(IERC20 /*_market*/, Side _side) external view returns (uint160 _marketPriceX96) {
        return _side.isLong() ? longMarketPriceX96 : shortMarketPriceX96;
    }

    function liquidateLiquidityPosition(IMarketDescriptor _market, address _account, address _feeReceiver) external {}

    function setLiquidityPosition(
        IMarketDescriptor market,
        address account,
        IMarketLiquidityPosition.LiquidityPosition memory _liquidityPosition
    ) external {
        liquidityPositions[market][account] = _liquidityPosition;
    }

    function setPosition(
        IMarketDescriptor _market,
        address _account,
        Side _side,
        IMarketPosition.Position memory _position
    ) external {
        positions[_market][_account][_side] = _position;
    }

    function liquidatePosition(
        IMarketDescriptor _market,
        address _account,
        Side _side,
        address _feeReceiver
    ) external {}

    function setMarketFeeRateConfig(IMarketDescriptor /*_market*/) external {
        marketFeeRateConfig = IConfigurable.MarketFeeRateConfig(0, 0, 0, 0, 0);
    }

    function marketFeeRateConfigs(
        IMarketDescriptor /*_market*/
    ) external view returns (IConfigurable.MarketFeeRateConfig memory) {
        return marketFeeRateConfig;
    }

    function setMarketBaseConfig(
        IMarketDescriptor /*_market*/,
        IConfigurable.MarketBaseConfig memory _marketBaseConfig
    ) external {
        marketBaseConfig = _marketBaseConfig;
    }

    function marketBaseConfigs(
        IMarketDescriptor /*_market*/
    ) external view returns (IConfigurable.MarketBaseConfig memory) {
        return marketBaseConfig;
    }

    function setGlobalPosition(
        IMarketDescriptor /*_market*/,
        IMarketPosition.GlobalPosition memory _globalPosition
    ) external {
        globalPosition = _globalPosition;
    }

    function globalPositions(
        IMarketDescriptor /*_market*/
    ) external view returns (IMarketPosition.GlobalPosition memory) {
        return globalPosition;
    }
}
