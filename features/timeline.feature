Feature: Revision timeline app

  Scenario: Opening the standalone JJ app shows snapshot timeline content
    Given I open the standalone revision timeline app for fixture "jj-basic"
    Then I should see the revision timeline header
    And I should see a diff title for the selected revision range
    And I should see the backend label "JJ"
    And I should see the range count "2/7 snapshots"
    And the button "Snapshot" should be active

  Scenario: Opening the standalone app for a git repo shows git-only history controls
    Given I open the standalone revision timeline app for fixture "git-basic"
    Then I should see the backend label "GIT"
    And I should see the range count "2/6 revisions"
    And the button "Snapshot" should not be visible

  Scenario: Selecting a range from the sidebar requires two clicks
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I select the revision "Current" from the sidebar
    Then the selection meta should contain "Pick another revision to complete the range."
    When I select the revision "woumzsyy/0" from the sidebar
    Then the diff title should contain "Current"
    And the diff title should contain "Snapshot"

  Scenario: Toggling in-between revisions changes the visible count
    Given I open the standalone revision timeline app for fixture "jj-basic"
    Then I should see the range count "2/7 snapshots"
    When I toggle the in-between revisions filter
    Then I should see the range count "2/5 snapshots"
    And I should see 5 sidebar revisions
    And the button "Show In-Between" should not be active
    And the in-between toggle should contain "Show In-Between 5/7"

  Scenario: Switching the comparison source updates the preview mode
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I toggle the in-between revisions filter
    And I switch the comparison source to "Revision"
    Then I should see the range count "2/4 revisions"
    And the diff mode eyebrow should contain "REVISION"
    And the button "Revision" should be active

  Scenario: Switching layout, content, and comparison modes changes the rendered preview
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I toggle the in-between revisions filter
    And I switch the comparison source to "Revision"
    When I switch the layout mode to "Unified"
    And I switch the content mode to "Whole file"
    And I switch the comparison mode to "Single"
    Then the diff layout mode should be "unified"
    And the diff content mode should be "full"
    And the diff mode eyebrow should contain "UNIFIED · WHOLE FILE · SINGLE · REVISION"
    And the step status should contain "3/3 diffs"

  Scenario: Searching revisions filters the sidebar list
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I search revisions for "working tree"
    Then I should see 1 sidebar revision

  Scenario: Typing a revision into the picker updates the selected range
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I submit "f406f829" into the "From revision" picker
    Then the diff title should contain "f406f829"

  Scenario: Keyboard and step controls move the selected diff range
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I press the "ArrowLeft" key
    Then the range count should stay at 2 selected revisions
    And the diff title should contain "b671cdd4"
    When I click the previous range button
    Then the diff title should contain "972dd9e5"

  Scenario: Keyboard shortcuts toggle UI and dispatch range actions
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I press the "Shift+/" key
    Then the hotkeys popover should be visible
    When I press the "Escape" key
    Then the hotkeys popover should be hidden
    When I press the "b" key
    Then the workspace should be collapsed
    When I press the "Space" key
    Then the last host action should be "open-range-files-diff"

  Scenario: Keyboard shortcuts focus controls and exit diff focus mode
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I press the "/" key
    Then the focused element should be "fileSwitcher"
    When I press the "f" key
    Then the focused element should be "fromRevisionInput"
    When I press the "t" key
    Then the focused element should be "toRevisionInput"
    When I press the "b" key
    Then the workspace should be collapsed
    When I press the "s" key
    Then the focused element should be "sidebarSearchInput"
    And the workspace should not be collapsed
    When I press the "d" key
    Then the workspace should be in diff focus mode
    When I press the "Escape" key
    Then the workspace should not be in diff focus mode

  Scenario: The actions menu dispatches extension actions
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I open the actions menu
    And I choose the action menu item "Open File"
    Then the last host action should be "open-current-file"
    And the last host action payload should include "fileName" as "lazy-di-rollout-plan.md"
    When I open the actions menu
    And I choose the action menu item "Open diff"
    Then the last host action should be "open-editor-diff"
    And the last host action payload should include "comparisonSource" as "snapshot"
    When I open the actions menu
    And I choose the action menu item "Open diffs"
    Then the last host action should be "open-range-files-diff"
    When I open the actions menu
    And I choose the action menu item "Cancel request"
    Then the last host action should be "cancel-active-request"
    When I open the actions menu
    And I choose the action menu item "Refresh"
    Then I should see the revision timeline header

  Scenario: Sidebar actions dispatch extension actions
    Given I open the standalone revision timeline app for fixture "jj-basic"
    When I click the sidebar open diff button
    Then the last host action should be "open-range-files-diff"
    When I click the "Remote" row action for revision "plan refinement"
    Then the last host action should be "open-revision-remote"
    And the last host action payload should include "revision" as "woumzsyy/0"
    When I click the "Open diffs" row action for revision "plan refinement"
    Then the last host action should be "open-revision-files-diff"

  Scenario: Switching files updates the preview content
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I switch to file "apps/backend/src/service.ts"
    Then the active fixture file should be "apps/backend/src/service.ts"
    And the file switcher value should be "apps/backend/src/service.ts"
    And the diff rows should contain "buildServiceLabel"

  Scenario: Pending timeline selections show a range preview tooltip
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I click timeline anchor 2
    And I hover timeline anchor 0
    Then the range tooltip should contain "Pending selection"
    And the range tooltip should contain "3 revisions"

  Scenario: Focus mode hides the surrounding chrome without losing the diff
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I click the diff focus button
    Then the workspace should be in diff focus mode
    When I click the diff focus button
    Then the workspace should not be in diff focus mode

  Scenario: Timeline preferences persist across reloads without restoring a collapsed sidebar
    Given I open the standalone revision timeline app for fixture "git-basic"
    When I open the actions menu
    And I choose the action menu item "Hide Sidebar"
    And I switch the layout mode to "Unified"
    And I switch the content mode to "Whole file"
    And I select the preset "All"
    And I click the timeline collapse button
    And the timeline pane should be collapsed
    When I reload the page
    Then the workspace should not be collapsed
    And the timeline pane should be collapsed
    When I click the timeline collapse button
    And the diff layout mode should be "unified"
    And the diff content mode should be "full"
    And the button "Unified" should be active
    And the button "Whole file" should be active
    And the button "All" should be active
