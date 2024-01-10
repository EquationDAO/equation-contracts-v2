// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "./Router.sol";
import "./EquationContractsV1RewardCollectorCompatibility.sol";
import "../farming/FarmRewardDistributor.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";

/// @notice The contract allows users to collect farm rewards and lockup and
/// burn the rewards based on the lockup period
contract RewardCollector is EquationContractsV1RewardCollectorCompatibility, Multicall {
    Router public immutable router;
    FarmRewardDistributor public immutable distributor;

    error InsufficientBalance(uint256 amount, uint256 requiredAmount);

    constructor(
        Router _router,
        IRouter _routerV1,
        FarmRewardDistributor _distributor,
        IFarmRewardDistributorV2 _distributorV2
    ) EquationContractsV1RewardCollectorCompatibility(_routerV1, _distributorV2) {
        router = _router;
        distributor = _distributor;
    }

    function sweepToken(
        IERC20 _token,
        uint256 _amountMinimum,
        address _receiver
    ) external virtual returns (uint256 amount) {
        amount = _token.balanceOf(address(this));
        if (amount < _amountMinimum) revert InsufficientBalance(amount, _amountMinimum);

        SafeERC20.safeTransfer(_token, _receiver, amount);
    }

    function collectReferralFeeBatch(
        IMarketDescriptor[] calldata _markets,
        uint256[] calldata _referralTokens
    ) external virtual returns (uint256 amount) {
        _validateOwner(_referralTokens);

        IMarketDescriptor market;
        uint256 marketsLen = _markets.length;
        uint256 tokensLen;
        for (uint256 i; i < marketsLen; ++i) {
            (market, tokensLen) = (_markets[i], _referralTokens.length);
            for (uint256 j; j < tokensLen; ++j)
                amount += router.pluginCollectReferralFee(market, _referralTokens[j], address(this));
        }
    }

    function collectFarmRewardBatch(
        PackedValue _nonceAndLockupPeriod,
        PackedValue[] calldata _packedMarketRewardValues,
        bytes calldata _signature,
        address _receiver
    ) external virtual {
        distributor.collectBatch(msg.sender, _nonceAndLockupPeriod, _packedMarketRewardValues, _signature, _receiver);
    }
}
