Feature: Revision timeline app

  Scenario: Opening the standalone app shows timeline content
    Given I open the standalone revision timeline app
    Then I should see the revision timeline header
    And I should see a diff title for the selected revision range

  Scenario: Selecting a revision from the sidebar updates the diff title
    Given I open the standalone revision timeline app
    When I select the revision "wywrvxml/0" from the sidebar
    Then the diff title should contain "wywrvxml/1"
    And the diff title should contain "wywrvxml/0"

  Scenario: Toggling in-between revisions changes the visible count
    Given I open the standalone revision timeline app
    Then I should see the range count "2/7 snapshots"
    When I toggle the in-between revisions filter
    Then I should see the range count "2/4 snapshots"

  Scenario: Switching layout mode changes the rendered diff rows
    Given I open the standalone revision timeline app
    Then the diff layout mode should be "split"
    When I switch the layout mode to "Unified"
    Then the diff layout mode should be "unified"
