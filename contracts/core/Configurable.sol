// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "../governance/Governable.sol";
import "./interfaces/IConfigurable.sol";
import "../libraries/ConfigurableUtil.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

abstract contract Configurable is IConfigurable, Governable, ReentrancyGuard {
    using ConfigurableUtil for mapping(IMarketDescriptor market => MarketConfig);

    IERC20 internal immutable usd;

    mapping(IMarketDescriptor market => MarketConfig) public marketConfigs;

    constructor(IERC20 _usd) {
        usd = _usd;
    }

    /// @inheritdoc IConfigurable
    function USD() external view override returns (IERC20) {
        return usd;
    }

    /// @inheritdoc IConfigurable
    function marketBaseConfigs(IMarketDescriptor _market) external view override returns (MarketBaseConfig memory) {
        return marketConfigs[_market].baseConfig;
    }

    /// @inheritdoc IConfigurable
    function marketFeeRateConfigs(
        IMarketDescriptor _market
    ) external view override returns (MarketFeeRateConfig memory) {
        return marketConfigs[_market].feeRateConfig;
    }

    /// @inheritdoc IConfigurable
    function isEnabledMarket(IMarketDescriptor _market) external view override returns (bool) {
        return _isEnabledMarket(_market);
    }

    /// @inheritdoc IConfigurable
    function marketPriceConfigs(IMarketDescriptor _market) external view override returns (MarketPriceConfig memory) {
        return marketConfigs[_market].priceConfig;
    }

    /// @inheritdoc IConfigurable
    function marketPriceVertexConfigs(
        IMarketDescriptor _market,
        uint8 _index
    ) external view override returns (VertexConfig memory) {
        return marketConfigs[_market].priceConfig.vertices[_index];
    }

    /// @inheritdoc IConfigurable
    function enableMarket(IMarketDescriptor _market, MarketConfig calldata _cfg) external override nonReentrant {
        _onlyGov();
        marketConfigs.enableMarket(_market, _cfg);

        afterMarketEnabled(_market);
    }

    /// @inheritdoc IConfigurable
    function updateMarketBaseConfig(
        IMarketDescriptor _market,
        MarketBaseConfig calldata _newCfg
    ) external override nonReentrant {
        _onlyGov();
        MarketBaseConfig storage oldCfg = marketConfigs[_market].baseConfig;
        bytes32 oldHash = keccak256(
            abi.encode(oldCfg.maxPositionLiquidity, oldCfg.maxPositionValueRate, oldCfg.maxSizeRatePerPosition)
        );
        marketConfigs.updateMarketBaseConfig(_market, _newCfg);
        bytes32 newHash = keccak256(
            abi.encode(_newCfg.maxPositionLiquidity, _newCfg.maxPositionValueRate, _newCfg.maxSizeRatePerPosition)
        );

        // If the hash has changed, it means that the maximum available size needs to be recalculated
        if (oldHash != newHash) afterMarketBaseConfigChanged(_market);
    }

    /// @inheritdoc IConfigurable
    function updateMarketFeeRateConfig(
        IMarketDescriptor _market,
        MarketFeeRateConfig calldata _newCfg
    ) external override nonReentrant {
        _onlyGov();
        marketConfigs.updateMarketFeeRateConfig(_market, _newCfg);
    }

    /// @inheritdoc IConfigurable
    function updateMarketPriceConfig(
        IMarketDescriptor _market,
        MarketPriceConfig calldata _newCfg
    ) external override nonReentrant {
        _onlyGov();
        marketConfigs.updateMarketPriceConfig(_market, _newCfg);

        afterMarketPriceConfigChanged(_market);
    }

    function afterMarketEnabled(IMarketDescriptor _market) internal virtual {
        // solhint-disable-previous-line no-empty-blocks
    }

    /// @dev The first time the market is enabled, this function does not need to be called
    function afterMarketBaseConfigChanged(IMarketDescriptor _market) internal virtual {
        // solhint-disable-previous-line no-empty-blocks
    }

    /// @dev The first time the market is enabled, this function does not need to be called
    function afterMarketPriceConfigChanged(IMarketDescriptor _market) internal virtual {
        // solhint-disable-previous-line no-empty-blocks
    }

    function _isEnabledMarket(IMarketDescriptor _market) internal view returns (bool) {
        return marketConfigs[_market].baseConfig.maxLeveragePerLiquidityPosition != 0;
    }
}
