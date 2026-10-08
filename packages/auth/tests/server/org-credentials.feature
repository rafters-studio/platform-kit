# Generated from legion requirement FR-PLATFORM-AUTH-115, revision 2026-10-07T23:46:26.446134+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Organization credentials for services

  @criterion-01a113a6-02c3-72b0-b3d6-6f4d3c0bcba4
  Scenario: An organization credential outlives the member who created it
    Given an organization with a member who is permitted to create organization credentials
    And that member has created an organization credential
    When the member leaves the organization
    And a service makes a request with that organization credential
    Then the request is authenticated as the organization

  @criterion-01a113a6-02c3-72b0-b3d6-6f5bc46f4a3c
  Scenario: An organization credential is refused a permission it was not given
    Given an organization credential that was given some permissions and not others
    When a service uses that credential to attempt an action requiring a permission it was not given
    Then the action is refused

  @criterion-01a113a6-02c3-72b0-b3d6-6f6628e3f5bf
  Scenario: A revoked organization credential no longer authenticates
    Given an organization credential that authenticates
    When the credential is revoked
    And a service makes a request with the revoked credential
    Then the request is not authenticated
