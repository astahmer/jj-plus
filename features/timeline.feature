Feature: Revision timeline app

  Scenario: Opening the standalone app shows timeline content
    Given I open the standalone revision timeline app for fixture "jj-basic"
    Then I should see the revision timeline header
    And I should see a diff title for the selected revision range

  Scenario: Opening the standalone app for a git repo shows git history
    Given I open the standalone revision timeline app for fixture "git-basic"
    Then I should see the backend label "GIT"
    And I should see the range count "2/5 revisions"

  Scenario: Selecting a revision from the sidebar updates the diff title
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I select the revision "Current" from the sidebar
    Then the diff title should contain "Current"

  Scenario: Toggling in-between revisions changes the visible count
    Given I open the standalone revision timeline app for fixture "jj-basic"
    Then I should see the range count "2/5 snapshots"
    When I toggle the in-between revisions filter
    Then I should see the range count "2/4 snapshots"

  Scenario: Switching layout mode changes the rendered diff rows
    Given I open the standalone revision timeline app for fixture "jj-basic"
    Then the diff layout mode should be "split"
    When I switch the layout mode to "Unified"
    Then the diff layout mode should be "unified"

  Scenario: Searching revisions filters the sidebar list
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I search revisions for "working tree"
    Then I should see 1 sidebar revision

  Scenario: Using keyboard arrows changes the selected diff range
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I press the "ArrowLeft" key
    Then the range count should stay at 2 selected revisions

  Scenario: Using the step buttons changes the selected diff range
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I click the previous range button
    Then the diff title should change
