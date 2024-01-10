// SPDX-License-Identifier: BUSL-1.1
pragma solidity =0.8.23;

contract MockEFC {
    uint256 private memberTokenId;
    uint256 private connectorTokenId;

    function setReferrerToken(address /*referee*/, uint256 _memberTokenId, uint256 _connectorTokenId) external {
        memberTokenId = _memberTokenId;
        connectorTokenId = _connectorTokenId;
    }

    function referrerTokens(address /*referee*/) external view returns (uint256, uint256) {
        return (memberTokenId, connectorTokenId);
    }
}
