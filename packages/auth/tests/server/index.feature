# Generated from legion requirement FR-PLATFORM-AUTH-103, revision 2026-10-07T23:46:26.581848+00:00.
# Do not edit: regenerate with scripts/features.mjs.

Feature: Identities never cross brands

  @criterion-01a11359-7d9c-7f40-b83a-4a74ba72a7b2
  Scenario: A session from one brand is not accepted by another brand
    Given a user signed in at brand A with a valid session
    When that session is presented to brand B
    Then brand B does not accept the session

  @criterion-01a11359-7d9c-7f40-b83a-4a86b453e8ea
  Scenario: An app password from one brand does not authenticate at another brand
    Given a user at brand A with an app password that authenticates at brand A
    When that app password is presented to brand B
    Then brand B does not authenticate it

  @criterion-01a11359-7d9c-7f40-b83a-4a935accbbc7
  Scenario: The same email at two brands is two separate users
    Given a person registers at brand A with an email address
    When the same person registers at brand B with the same email address
    Then brand A and brand B each hold their own user for that email
    And the two users have different identities
