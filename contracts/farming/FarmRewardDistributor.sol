// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import "../types/PackedValue.sol";
import "../core/MarketIndexer.sol";
import "../libraries/Constants.sol";
import "../governance/Governable.sol";
import "../IEquationContractsV1Minimum.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract FarmRewardDistributor is Governable, ReentrancyGuard {
    using SafeCast for *;
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @notice The address of the signer
    address public immutable signer;
    /// @notice The address of the token to be distributed
    IERC20 public immutable token;
    /// @notice The address of the EFC token
    IEFC public immutable EFC;
    /// @notice The address of the fee distributor
    IFeeDistributor public immutable feeDistributor;
    /// @notice The address of the distributor v2
    IFarmRewardDistributorV2 public immutable distributorV2;
    /// @notice The address of the market indexer
    MarketIndexer public immutable marketIndexer;

    /// @notice The collectors
    mapping(address collector => bool active) public collectors;

    /// @notice The nonces for each account
    mapping(address account => uint32 nonce) public nonces;
    /// @notice Mapping of accounts to their collected rewards for corresponding markets and reward types
    mapping(address account => mapping(IMarketDescriptor market => mapping(uint16 rewardType => uint200 amount)))
        public collectedRewards;
    /// @notice Mapping of referral tokens to their collected rewards for corresponding markets and reward types
    mapping(uint16 referralToken => mapping(IMarketDescriptor market => mapping(uint16 rewardType => uint200 amount)))
        public collectedReferralRewards;

    modifier onlyCollector() {
        if (!collectors[msg.sender]) revert Forbidden();
        _;
    }

    constructor(IFarmRewardDistributorV2 _distributorV2, MarketIndexer _marketIndexer) {
        distributorV2 = _distributorV2;
        signer = _distributorV2.signer();
        token = _distributorV2.token();
        EFC = _distributorV2.EFC();
        feeDistributor = _distributorV2.feeDistributor();
        marketIndexer = _marketIndexer;

        token.approve(address(feeDistributor), type(uint256).max);
    }

    /// @notice Set whether the address of the reward collector is enabled or disabled
    /// @param _collector Address to set
    /// @param _enabled Whether the address is enabled or disabled
    function setCollector(address _collector, bool _enabled) external virtual onlyGov {
        collectors[_collector] = _enabled;
        emit IFarmRewardDistributorV2.CollectorUpdated(_collector, _enabled);
    }

    /// @notice Collect the farm reward by the collector
    /// @param _account The account that collect the reward for
    /// @param _nonceAndLockupPeriod The packed values of the nonce and lockup period: bit 0-31 represent the nonce,
    /// bit 32-47 represent the lockup period
    /// @param _packedMarketRewardValues The packed values of the market index, reward type,
    /// and amount: bit 0-23 represent the market index, bit 24-39 represent the reward type, bit 40-55 represent the
    /// referral token, and bit 56-255
    /// represent the amount. If the referral token is non-zero, the account MUST be the owner of the referral token
    /// @param _signature The signature of the parameters to verify
    /// @param _receiver The address that received the reward
    function collectBatch(
        address _account,
        PackedValue _nonceAndLockupPeriod,
        PackedValue[] calldata _packedMarketRewardValues,
        bytes calldata _signature,
        address _receiver
    ) external virtual nonReentrant onlyCollector {
        if (_receiver == address(0)) _receiver = msg.sender;

        // check nonce
        uint32 nonce = _nonceAndLockupPeriod.unpackUint32(0);
        if (nonce != nonces[_account] + 1) revert IFarmRewardDistributorV2.InvalidNonce(nonce);

        // check lokup period
        uint16 lockupPeriod = _nonceAndLockupPeriod.unpackUint16(32);
        uint32 lockupFreeRate = distributorV2.lockupFreeRates(lockupPeriod);
        if (lockupFreeRate == 0) revert IFeeDistributor.InvalidLockupPeriod(lockupPeriod);

        // check signature
        address _signer = keccak256(abi.encode(_account, _nonceAndLockupPeriod, _packedMarketRewardValues))
            .toEthSignedMessageHash()
            .recover(_signature);
        if (_signer != signer) revert IFarmRewardDistributorV2.InvalidSignature();

        uint256 totalCollectableReward;
        IMarketDescriptor market;
        PackedValue packedMarketRewardValue;
        uint256 len = _packedMarketRewardValues.length;
        for (uint256 i; i < len; ++i) {
            packedMarketRewardValue = _packedMarketRewardValues[i];
            market = marketIndexer.indexMarkets(packedMarketRewardValue.unpackUint24(0));
            if (address(market) == address(0)) revert MarketIndexer.InvalidMarket(market);

            uint16 rewardType = packedMarketRewardValue.unpackUint16(24);
            if (bytes(distributorV2.rewardTypesDescriptions(rewardType)).length == 0)
                revert IFarmRewardDistributorV2.InvalidRewardType(rewardType);

            uint16 referralToken = packedMarketRewardValue.unpackUint16(40);
            uint200 amount = packedMarketRewardValue.unpackUint200(56);
            uint200 collectableReward = amount - _collectedRewardFor(_account, market, rewardType, referralToken);
            if (referralToken > 0) {
                if (EFC.ownerOf(referralToken) != _account)
                    revert IFeeDistributor.InvalidNFTOwner(_account, referralToken);

                collectedReferralRewards[referralToken][market][rewardType] = amount;
            } else {
                collectedRewards[_account][market][rewardType] = amount;
            }

            totalCollectableReward += collectableReward;
            emit IFarmRewardDistributorV2.RewardCollected(
                address(market),
                _account,
                rewardType,
                referralToken,
                nonce,
                _receiver,
                collectableReward
            );
        }

        nonces[_account] = nonce;

        _lockupAndBurnToken(_account, lockupPeriod, lockupFreeRate, totalCollectableReward, _receiver);
    }

    function _collectedRewardFor(
        address _account,
        IMarketDescriptor _market,
        uint16 _rewardType,
        uint16 _referralToken
    ) internal view virtual returns (uint200 collectedReward) {
        if (_referralToken > 0) collectedReward = collectedReferralRewards[_referralToken][_market][_rewardType];
        else collectedReward = collectedRewards[_account][_market][_rewardType];
    }

    function _lockupAndBurnToken(
        address _account,
        uint16 _lockupPeriod,
        uint32 _lockupFreeRate,
        uint256 _totalCollectableReward,
        address _receiver
    ) internal virtual {
        Address.functionCall(
            address(token),
            abi.encodeWithSignature("mint(address,uint256)", address(this), _totalCollectableReward)
        );

        uint256 lockedOrUnlockedAmount = (_totalCollectableReward * _lockupFreeRate) / Constants.BASIS_POINTS_DIVISOR;
        uint256 burnedAmount = _totalCollectableReward - lockedOrUnlockedAmount;

        // first burn the token
        if (burnedAmount > 0) token.safeTransfer(address(0x1), burnedAmount);

        // then lockup or transfer the token
        if (_lockupPeriod == 0) token.safeTransfer(_receiver, lockedOrUnlockedAmount);
        else feeDistributor.stake(lockedOrUnlockedAmount, _receiver, _lockupPeriod);

        emit IFarmRewardDistributorV2.RewardLockedAndBurned(
            _account,
            _lockupPeriod,
            _receiver,
            lockedOrUnlockedAmount,
            burnedAmount
        );
    }
}
