// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

import {M as Math} from "../libraries/Math.sol";
import "../plugins/interfaces/IPositionRouter.sol";

interface IPositionRouterState is IPositionRouter {
    function increaseLiquidityPositionIndex() external view returns (uint128);

    function increaseLiquidityPositionIndexNext() external view returns (uint128);

    function increaseLiquidityPositionRequests(
        uint128 index
    ) external view returns (IncreaseLiquidityPositionRequest memory);

    function decreaseLiquidityPositionIndex() external view returns (uint128);

    function decreaseLiquidityPositionIndexNext() external view returns (uint128);

    function decreaseLiquidityPositionRequests(
        uint128 index
    ) external view returns (DecreaseLiquidityPositionRequest memory);

    function increasePositionIndex() external view returns (uint128);

    function increasePositionIndexNext() external view returns (uint128);

    function increasePositionRequests(uint128 index) external view returns (IncreasePositionRequest memory);

    function decreasePositionIndex() external view returns (uint128);

    function decreasePositionIndexNext() external view returns (uint128);

    function decreasePositionRequests(uint128 index) external view returns (DecreasePositionRequest memory);
}

contract ExecutorAssistant {
    struct IndexPerOperation {
        /// @dev The start index of the operation
        uint128 index;
        /// @dev The next index of the operation
        uint128 indexNext;
        /// @dev The end index of the operation.
        /// If the index == indexNext, indexEnd is invalid.
        uint128 indexEnd;
    }

    IPositionRouterState public immutable positionRouter;

    constructor(IPositionRouterState _positionRouter) {
        positionRouter = _positionRouter;
    }

    /// @dev Calculate the next market that `Multicall` needs to update the price, and the required indexEnd
    /// @param _max The maximum index that execute in one call
    /// @return markets The market in which to update the price, address(0) means no operation
    /// @return indexPerOperations The index of the per operation
    function calculateNextMulticall(
        uint128 _max
    ) external view returns (IMarketDescriptor[] memory markets, IndexPerOperation[4] memory indexPerOperations) {
        markets = new IMarketDescriptor[](4 * _max);
        uint256 marketIndex;

        // scope for increase liquidity position
        {
            IndexPerOperation memory indexPerOperation = indexPerOperations[0];
            (indexPerOperation.index, indexPerOperation.indexNext) = (
                positionRouter.increaseLiquidityPositionIndex(),
                positionRouter.increaseLiquidityPositionIndexNext()
            );
            if (indexPerOperation.index != indexPerOperation.indexNext) {
                indexPerOperation.indexEnd = uint128(
                    Math.min(indexPerOperation.index + _max, indexPerOperation.indexNext)
                );
                uint128 index = indexPerOperation.index;
                while (index < indexPerOperation.indexEnd) {
                    IPositionRouter.IncreaseLiquidityPositionRequest memory request = positionRouter
                        .increaseLiquidityPositionRequests(index);
                    if (request.account != address(0)) markets[marketIndex++] = request.market;

                    // prettier-ignore
                    unchecked { index++; }
                }
            }
        }

        // scope for decrease liquidity position
        {
            IndexPerOperation memory indexPerOperation = indexPerOperations[1];
            (indexPerOperation.index, indexPerOperation.indexNext) = (
                positionRouter.decreaseLiquidityPositionIndex(),
                positionRouter.decreaseLiquidityPositionIndexNext()
            );
            if (indexPerOperation.index != indexPerOperation.indexNext) {
                indexPerOperation.indexEnd = uint128(
                    Math.min(indexPerOperation.index + _max, indexPerOperation.indexNext)
                );
                uint128 index = indexPerOperation.index;
                while (index < indexPerOperation.indexEnd) {
                    IPositionRouter.DecreaseLiquidityPositionRequest memory request = positionRouter
                        .decreaseLiquidityPositionRequests(index);
                    if (request.account != address(0)) markets[marketIndex++] = request.market;

                    // prettier-ignore
                    unchecked { index++; }
                }
            }
        }

        // scope for increase position
        {
            IndexPerOperation memory indexPerOperation = indexPerOperations[2];
            (indexPerOperation.index, indexPerOperation.indexNext) = (
                positionRouter.increasePositionIndex(),
                positionRouter.increasePositionIndexNext()
            );
            if (indexPerOperation.index != indexPerOperation.indexNext) {
                indexPerOperation.indexEnd = uint128(
                    Math.min(indexPerOperation.index + _max, indexPerOperation.indexNext)
                );
                uint128 index = indexPerOperation.index;
                while (index < indexPerOperation.indexEnd) {
                    IPositionRouter.IncreasePositionRequest memory request = positionRouter.increasePositionRequests(
                        index
                    );
                    if (request.account != address(0)) markets[marketIndex++] = request.market;

                    // prettier-ignore
                    unchecked { index++; }
                }
            }
        }

        // scope for decrease position
        {
            IndexPerOperation memory indexPerOperation = indexPerOperations[3];
            (indexPerOperation.index, indexPerOperation.indexNext) = (
                positionRouter.decreasePositionIndex(),
                positionRouter.decreasePositionIndexNext()
            );
            if (indexPerOperation.index != indexPerOperation.indexNext) {
                indexPerOperation.indexEnd = uint128(
                    Math.min(indexPerOperation.index + _max, indexPerOperation.indexNext)
                );
                uint128 index = indexPerOperation.index;
                while (index < indexPerOperation.indexEnd) {
                    IPositionRouter.DecreasePositionRequest memory request = positionRouter.decreasePositionRequests(
                        index
                    );
                    if (request.account != address(0)) markets[marketIndex++] = request.market;

                    // prettier-ignore
                    unchecked { index++; }
                }
            }
        }
        uint dropNum = markets.length - marketIndex;
        // prettier-ignore
        assembly { mstore(markets, sub(mload(markets), dropNum)) }
    }
}
