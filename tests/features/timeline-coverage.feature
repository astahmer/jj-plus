Feature: Revision timeline coverage

  Scenario: Sidebar sort order reverses the visible revision list
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I toggle the in-between revisions filter
    Then the first sidebar revision should contain "Current"
    And the last sidebar revision should contain "235489e2"
    When I toggle the sidebar sort order
    Then the first sidebar revision should contain "235489e2"
    And the last sidebar revision should contain "Current"

  Scenario: Typing into the To revision picker updates the selected range
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I submit "235489e2" into the "From revision" picker
    And I submit "972dd9e5" into the "To revision" picker
    Then the diff title should contain "972dd9e5"
    And the to handle label should contain "972dd9e5"

  Scenario: Fast step controls jump across the revision track
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I toggle the in-between revisions filter
    And I submit "235489e2" into the "From revision" picker
    And I submit "f406f829" into the "To revision" picker
    And I click the fast forward range button
    Then the from handle label should contain "b671cdd4"
    And the to handle label should contain "Current"
    When I click the fast backward range button
    Then the from handle label should contain "235489e2"
    And the to handle label should contain "f406f829"

  Scenario: ArrowRight moves the selected range forward
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I press the "ArrowLeft" key
    Then the diff title should contain "b671cdd4"
    When I press the "ArrowRight" key
    Then the range count should stay at 2 selected revisions
    And the diff title should contain "Current"

  Scenario: Dock shortcuts move the selected range to the timeline edges
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I toggle the in-between revisions filter
    And I submit "f406f829" into the "From revision" picker
    And I submit "b671cdd4" into the "To revision" picker
    When I dispatch the timeline shortcut "Meta+ArrowLeft"
    Then the from handle label should contain "235489e2"
    When I dispatch the timeline shortcut "Meta+ArrowRight"
    Then the to handle label should contain "Current"

  Scenario: Clicking the pending sidebar revision again cancels the pending selection
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I select the revision "Current" from the sidebar
    Then the selection meta should contain "Pick another revision to complete the range."
    When I select the revision "Current" from the sidebar
    Then the selection meta should not contain "Pick another revision to complete the range."

  Scenario: Switching comparison source back to Snapshot restores the snapshot controls
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I toggle the in-between revisions filter
    And I switch the comparison source to "Revision"
    Then the button "Revision" should be active
    When I switch the comparison source to "Snapshot"
    Then the button "Snapshot" should be active
    And I should see the range count "2/5 snapshots"
    And the diff mode eyebrow should contain "SNAPSHOT"

  Scenario: Reset preferences restores the default chrome after customizing layout
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I switch the layout mode to "Unified"
    And I switch the content mode to "Whole file"
    And I select the preset "All"
    Then the button "Unified" should be active
    And the button "Whole file" should be active
    And the button "All" should be active
    When I open the actions menu
    And I choose the action menu item "Reset preferences"
    Then the button "Split" should be active
    And the button "Diffs" should be active
    And the button "This year" should be active

  Scenario: Hotkeys can be opened from the toolbar button and closed from the card
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I click the hotkeys button
    Then the hotkeys popover should be visible
    When I click the close hotkeys button
    Then the hotkeys popover should be hidden

  Scenario: Escape closes the open actions menu
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I open the actions menu
    Then the actions menu should be visible
    When I press the "Escape" key
    Then the actions menu should be hidden

  Scenario: Showing the sidebar again from the actions menu restores the workspace
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I open the actions menu
    And I choose the action menu item "Hide Sidebar"
    Then the workspace should be collapsed
    When I open the actions menu
    And I choose the action menu item "Show Sidebar"
    Then the workspace should not be collapsed

  Scenario: JJ rename history keeps pre-rename revisions visible in the sidebar
    Given I open the standalone revision timeline app for fixture "jj-rename"
    Then I should see 3 sidebar revisions
    And I should see the sidebar revision "initial commitment file"
    And I should see the sidebar revision "rename packages to apps"
    And I should see the sidebar revision "update commitment after rename"
    And the newest sidebar revision should show an introduced badge

  Scenario: Top changed mode shows an overview summary and can return to all files
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I switch the file switcher mode to "Top changed"
    Then the file switcher summary should be visible
    And the button "Top changed" should be active
    When I switch the file switcher mode to "All files"
    Then the button "All files" should be active
    And the file switcher summary should be hidden

  Scenario: Searching by revision id filters the sidebar and clearing restores it
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I toggle the in-between revisions filter
    Then I should see 4 sidebar revisions
    When I search revisions for "f406f829"
    Then I should see 1 sidebar revision
    And I should see the sidebar revision "f406f829"
    When I search revisions for ""
    Then I should see 4 sidebar revisions

  Scenario: Structured sidebar search supports field filters and OR
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I toggle the in-between revisions filter
    Then I should see 4 sidebar revisions
    When I search revisions for "revset:f406f829 OR revset:235489e2"
    Then I should see 2 sidebar revisions
    When I search revisions for "author:Nobody"
    Then I should see 0 sidebar revisions
    When I search revisions for ""
    Then I should see 4 sidebar revisions

  Scenario: Selecting the Last 7D preset keeps a usable selected range
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I select the preset "Last 7D"
    Then the button "Last 7D" should be active
    And I should see a diff title for the selected revision range
    And the range count should stay at 2 selected revisions

  Scenario: Single comparison mode exposes step status and next-step navigation
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I toggle the in-between revisions filter
    And I switch the comparison mode to "Single"
    Then the step status should contain "diffs"
    And the diff mode eyebrow should contain "SINGLE"
    When I click the previous range button
    Then I should see a diff title for the selected revision range
    When I click the next range button
    Then the to handle label should contain "Current"

  Scenario: Comparison source preference persists across reload for JJ
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I toggle the in-between revisions filter
    And I switch the comparison source to "Revision"
    Then the button "Revision" should be active
    When I reload the page
    Then the button "Revision" should be active
    And the diff mode eyebrow should contain "REVISION"

  Scenario: Refresh from the actions menu keeps the timeline ready
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I open the actions menu
    And I choose the action menu item "Refresh"
    Then I should see the revision timeline header
    And I should see a diff title for the selected revision range
    And the file switcher value should be "apps/backend/instructions/lazy-di-rollout-plan.md"

  Scenario: Diff stats render for the selected range
    Given I open the standalone revision timeline app for fixture "git-basic"
    Then the diff panel should show addition stats
    And the diff panel should show deletion stats

  Scenario: Sidebar toggle button collapses and restores the workspace
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I click the sidebar toggle button
    Then the workspace should be collapsed
    When I click the sidebar toggle button
    Then the workspace should not be collapsed

  Scenario: Track marker drag adjusts one boundary of the selected range
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I toggle the in-between revisions filter
    And I submit "f406f829" into the "From revision" picker
    And I submit "b671cdd4" into the "To revision" picker
    And I drag the to marker toward the end of the track
    Then the to handle label should contain "Current"
    And the selection meta should not contain "Pick another revision to complete the range."
