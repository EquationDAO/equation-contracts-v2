// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "./PluginManager.sol";
import {Side} from "../types/Side.sol";
import "../IEquationContractsV1Minimum.sol";
import "../core/interfaces/IMarketManager.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

contract Router is PluginManager {
    using SafeERC20 for IERC20;

    IEFC public immutable EFC;
    IMarketManager public immutable marketManager;

    /// @notice Caller is not a plugin or not approved
    error CallerUnauthorized();
    /// @notice Owner mismatch
    error OwnerMismatch(address owner, address expectedOwner);

    constructor(IEFC _EFC, IMarketManager _marketManager) {
        (EFC, marketManager) = (_EFC, _marketManager);
    }

    /// @notice Transfers `_amount` of `_token` from `_from` to `_to`
    /// @param _token The address of the ERC20 token
    /// @param _from The address to transfer the tokens from
    /// @param _to The address to transfer the tokens to
    /// @param _amount The amount of tokens to transfer
    function pluginTransfer(IERC20 _token, address _from, address _to, uint256 _amount) external {
        _onlyPluginApproved(_from);
        SafeERC20.safeTransferFrom(_token, _from, _to, _amount);
    }

    /// @notice Transfers an NFT token from `_from` to `_to`
    /// @param _token The address of the ERC721 token to transfer
    /// @param _from The address to transfer the NFT from
    /// @param _to The address to transfer the NFT to
    /// @param _tokenId The ID of the NFT token to transfer
    function pluginTransferNFT(IERC721 _token, address _from, address _to, uint256 _tokenId) external {
        _onlyPluginApproved(_from);
        _token.safeTransferFrom(_from, _to, _tokenId);
    }

    /// @notice Open a new liquidity position
    /// @param _market The market in which to open liquidity position
    /// @param _account The owner of the position
    /// @param _marginDelta The margin of the position
    /// @param _liquidityDelta The liquidity (value) of the position
    /// @param marginAfter The margin after increasing the position
    function pluginIncreaseLiquidityPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _marginDelta,
        uint128 _liquidityDelta
    ) external returns (uint128 marginAfter) {
        _onlyPluginApproved(_account);
        return marketManager.increaseLiquidityPosition(_market, _account, _marginDelta, _liquidityDelta);
    }

    /// @notice Close a liquidity position
    /// @param _market The market in which to close liquidity position
    /// @param _account The owner of the liquidation position
    /// @param _marginDelta The increase in margin, which can be 0
    /// @param _liquidityDelta The decrease in liquidity, which can be 0
    /// @param _receiver The address to receive the margin at the time of closing
    /// @param marginAfter The margin after decreasing the position
    function pluginDecreaseLiquidityPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _marginDelta,
        uint128 _liquidityDelta,
        address _receiver
    ) external returns (uint128 marginAfter) {
        _onlyPluginApproved(_account);
        return marketManager.decreaseLiquidityPosition(_market, _account, _marginDelta, _liquidityDelta, _receiver);
    }

    /// @notice Liquidate a liquidity position
    /// @param _market The market in which to liquidate liquidity position
    /// @param _account The owner of the liquidation position
    /// @param _feeReceiver The address to receive the fee
    function pluginLiquidateLiquidityPosition(
        IMarketDescriptor _market,
        address _account,
        address _feeReceiver
    ) external {
        _onlyLiquidator();
        marketManager.liquidateLiquidityPosition(_market, _account, _feeReceiver);
    }

    /// @notice Increase a liquidation fund position
    /// @param _market The market in which to increase liquidation fund position
    /// @param _account The owner of the liquidation fund position
    /// @param _liquidityDelta The liquidity (value) of the liquidation fund position
    function pluginIncreaseLiquidationFundPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _liquidityDelta
    ) external {
        _onlyPluginApproved(_account);
        return marketManager.increaseLiquidationFundPosition(_market, _account, _liquidityDelta);
    }

    /// @notice Decrease the liquidity (value) of a liquidation fund position
    /// @param _market The market in which to decrease liquidation fund position
    /// @param _account The owner of the liquidation fund position
    /// @param _liquidityDelta The decrease in liquidity
    /// @param _receiver The address to receive the liquidity
    function pluginDecreaseLiquidationFundPosition(
        IMarketDescriptor _market,
        address _account,
        uint128 _liquidityDelta,
        address _receiver
    ) external {
        _onlyPluginApproved(_account);
        return marketManager.decreaseLiquidationFundPosition(_market, _account, _liquidityDelta, _receiver);
    }

    /// @notice Increase the margin/liquidity (value) of a position
    /// @param _market The market in which to increase position
    /// @param _account The owner of the position
    /// @param _side The side of the position (Long or Short)
    /// @param _marginDelta The increase in margin, which can be 0
    /// @param _sizeDelta The increase in size, which can be 0
    /// @return tradePriceX96 The trade price at which the position is adjusted.
    /// If only adding margin, it returns 0, as a Q64.96
    function pluginIncreasePosition(
        IMarketDescriptor _market,
        address _account,
        Side _side,
        uint128 _marginDelta,
        uint128 _sizeDelta
    ) external returns (uint160 tradePriceX96) {
        _onlyPluginApproved(_account);
        return marketManager.increasePosition(_market, _account, _side, _marginDelta, _sizeDelta);
    }

    /// @notice Decrease the margin/liquidity (value) of a position
    /// @param _market The market in which to decrease position
    /// @param _account The owner of the position
    /// @param _side The side of the position (Long or Short)
    /// @param _marginDelta The decrease in margin, which can be 0
    /// @param _sizeDelta The decrease in size, which can be 0
    /// @param _receiver The address to receive the margin
    /// @return tradePriceX96 The trade price at which the position is adjusted.
    /// If only reducing margin, it returns 0, as a Q64.96
    function pluginDecreasePosition(
        IMarketDescriptor _market,
        address _account,
        Side _side,
        uint128 _marginDelta,
        uint128 _sizeDelta,
        address _receiver
    ) external returns (uint160 tradePriceX96) {
        _onlyPluginApproved(_account);
        return marketManager.decreasePosition(_market, _account, _side, _marginDelta, _sizeDelta, _receiver);
    }

    /// @notice Liquidate a position
    /// @param _market The market in which to close position
    /// @param _account The owner of the position
    /// @param _side The side of the position (Long or Short)
    /// @param _feeReceiver The address to receive the fee
    function pluginLiquidatePosition(
        IMarketDescriptor _market,
        address _account,
        Side _side,
        address _feeReceiver
    ) external {
        _onlyLiquidator();
        marketManager.liquidatePosition(_market, _account, _side, _feeReceiver);
    }

    /// @notice Close a position by the liquidator
    /// @param _market The market in which to close position
    /// @param _account The owner of the position
    /// @param _side The side of the position (Long or Short)
    /// @param _sizeDelta The decrease in size
    /// @param _receiver The address to receive the margin
    function pluginClosePositionByLiquidator(
        IMarketDescriptor _market,
        address _account,
        Side _side,
        uint128 _sizeDelta,
        address _receiver
    ) external {
        _onlyLiquidator();
        marketManager.decreasePosition(_market, _account, _side, 0, _sizeDelta, _receiver);
    }

    /// @notice Collect the referral fee
    /// @param _market The market in which to collect referral fee
    /// @param _referralToken The id of the referral token
    /// @param _receiver The address to receive the referral fee
    /// @return The amount of referral fee received
    function pluginCollectReferralFee(
        IMarketDescriptor _market,
        uint256 _referralToken,
        address _receiver
    ) external returns (uint256) {
        _onlyPluginApproved(EFC.ownerOf(_referralToken));
        return marketManager.collectReferralFee(_market, _referralToken, _receiver);
    }

    /// @notice Sample and adjust the funding rate
    /// @param _market The market in which to sample and adjust funding rate
    function pluginSampleAndAdjustFundingRate(IMarketDescriptor _market) external {
        _onlyPlugin();
        marketManager.sampleAndAdjustFundingRate(_market);
    }

    function _onlyPlugin() internal view {
        if (!registeredPlugins[msg.sender]) revert CallerUnauthorized();
    }

    function _onlyPluginApproved(address _account) internal view {
        if (!isPluginApproved(_account, msg.sender)) revert CallerUnauthorized();
    }

    function _onlyLiquidator() internal view {
        if (!isRegisteredLiquidator(msg.sender)) revert CallerUnauthorized();
    }
}
