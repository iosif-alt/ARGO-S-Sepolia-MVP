// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.17;

import "../compliance/modular/IModularCompliance.sol";
import "../compliance/modular/modules/AbstractModule.sol";
import "../token/IToken.sol";

/// @title ARGO-S authorized supply limit
/// @notice Prevents the token supply from exceeding the immutable corporate authorization limit.
contract ARGOSupplyLimitModule is AbstractModule {
    uint256 private immutable _SUPPLY_LIMIT;

    error InvalidSupplyLimit();
    error AuthorizedSupplyExceeded();

    constructor(uint256 supplyLimit_) {
        if (supplyLimit_ == 0) {
            revert InvalidSupplyLimit();
        }
        _SUPPLY_LIMIT = supplyLimit_;
    }

    /// @notice Transfers do not change supply and require no state update.
    // solhint-disable-next-line no-empty-blocks
    function moduleTransferAction(address, address, uint256) external override onlyComplianceCall { }

    /// @notice Burns reduce supply and require no state update.
    // solhint-disable-next-line no-empty-blocks
    function moduleBurnAction(address, uint256) external override onlyComplianceCall { }

    /// @notice Rechecks the post-mint state so a future token implementation cannot bypass the pre-check.
    function moduleMintAction(address, uint256) external view override onlyComplianceCall {
        address token = IModularCompliance(msg.sender).getTokenBound();
        if (IToken(token).totalSupply() > _SUPPLY_LIMIT) {
            revert AuthorizedSupplyExceeded();
        }
    }

    /// @notice Rejects a proposed mint when current supply plus the amount exceeds the limit.
    function moduleCheck(
        address from,
        address,
        uint256 value,
        address compliance
    ) external view override onlyBoundCompliance(compliance) returns (bool) {
        if (from != address(0)) {
            return true;
        }

        address token = IModularCompliance(compliance).getTokenBound();
        return IToken(token).totalSupply() + value <= _SUPPLY_LIMIT;
    }

    function canComplianceBind(address compliance) external view override returns (bool) {
        return compliance != address(0) && IModularCompliance(compliance).getTokenBound() != address(0);
    }

    function supplyLimit() external view returns (uint256) {
        return _SUPPLY_LIMIT;
    }

    function isPlugAndPlay() external pure override returns (bool) {
        return false;
    }

    function name() external pure override returns (string memory) {
        return "ARGO Supply Limit Module";
    }
}
