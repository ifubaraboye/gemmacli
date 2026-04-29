"""
Simple Q-Learning Demo (No external dependencies)
A grid world where an agent learns to navigate from start (S) to goal (G)
avoiding holes (H).
"""

import random

# Environment: 4x4 grid
# S = Start, G = Goal, H = Hole, . = Safe path
GRID = [
    ['S', '.', '.', '.'],
    ['.', 'H', '.', 'H'],
    ['.', '.', '.', '.'],
    ['H', '.', '.', 'G']
]

class GridWorld:
    def __init__(self):
        self.grid = GRID
        self.rows = len(self.grid)
        self.cols = len(self.grid[0])
        self.start_pos = (0, 0)
        self.goal_pos = (3, 3)
        self.state = self.start_pos

        # Actions: 0=up, 1=right, 2=down, 3=left
        self.actions = [0, 1, 2, 3]
        self.action_names = ['up', 'right', 'down', 'left']

    def reset(self):
        self.state = self.start_pos
        return self.state

    def step(self, action):
        row, col = self.state

        # Calculate new position
        if action == 0:    # up
            new_row, new_col = max(0, row - 1), col
        elif action == 1:  # right
            new_row, new_col = row, min(self.cols - 1, col + 1)
        elif action == 2:  # down
            new_row, new_col = min(self.rows - 1, row + 1), col
        elif action == 3:  # left
            new_row, new_col = row, max(0, col - 1)

        self.state = (new_row, new_col)
        cell = self.grid[new_row][new_col]

        # Rewards
        if cell == 'G':
            reward = 100
            done = True
        elif cell == 'H':
            reward = -50
            done = True
        else:
            reward = -1  # small penalty per step
            done = False

        return self.state, reward, done

    def render(self):
        for r in range(self.rows):
            row_str = ""
            for c in range(self.cols):
                if (r, c) == self.state:
                    row_str += " A "
                else:
                    row_str += f" {self.grid[r][c]} "
            print(row_str)
        print()


def create_q_table(rows, cols, num_actions):
    """Create empty Q-table initialized to zeros"""
    return [[[0.0 for _ in range(num_actions)] for _ in range(cols)] for _ in range(rows)]


def max_q_value(q_table, row, col):
    """Get maximum Q-value for a state"""
    return max(q_table[row][col])


def q_learning(env, episodes=500, alpha=0.1, gamma=0.9, epsilon=0.1):
    """
    Q-Learning algorithm

    alpha: learning rate (how fast to update Q-values)
    gamma: discount factor (value of future rewards)
    epsilon: exploration rate (probability of random action)
    """
    # Initialize Q-table
    q_table = create_q_table(env.rows, env.cols, len(env.actions))

    for episode in range(episodes):
        state = env.reset()
        done = False
        steps = 0

        while not done and steps < 100:
            row, col = state

            # Epsilon-greedy action selection
            if random.random() < epsilon:
                action = random.choice(env.actions)  # Explore
            else:
                # Exploit: choose action with highest Q-value
                q_values = q_table[row][col]
                max_q = max(q_values)
                # Find all actions with max Q-value (handle ties)
                best_actions = [i for i, q in enumerate(q_values) if q == max_q]
                action = random.choice(best_actions)  # Random among best

            # Take action
            next_state, reward, done = env.step(action)
            next_row, next_col = next_state

            # Q-learning update rule
            old_value = q_table[row][col][action]
            next_max = max(q_table[next_row][next_col])
            new_value = old_value + alpha * (reward + gamma * next_max - old_value)
            q_table[row][col][action] = new_value

            state = next_state
            steps += 1

        if (episode + 1) % 100 == 0:
            print(f"Episode {episode + 1}/{episodes}")

    return q_table


def extract_policy(q_table):
    """Extract the learned policy from Q-table"""
    policy = {}
    for r in range(len(q_table)):
        for c in range(len(q_table[0])):
            q_values = q_table[r][c]
            best_action = q_values.index(max(q_values))
            policy[(r, c)] = env.action_names[best_action]
    return policy


def run_episode_with_policy(env, policy, render=True):
    """Run one episode following the learned policy"""
    state = env.reset()
    done = False
    total_reward = 0
    steps = 0

    print("Running episode with learned policy:\n")
    while not done and steps < 100:
        if render:
            env.render()
        action_name = policy[state]
        action = env.action_names.index(action_name)
        state, reward, done = env.step(action)
        total_reward += reward
        steps += 1

    print(f"\nTotal reward: {total_reward}, Steps: {steps}")
    return total_reward


if __name__ == "__main__":
    print("=" * 50)
    print("Q-LEARNING DEMO")
    print("=" * 50)

    env = GridWorld()

    print("\nGrid World:")
    env.render()

    print("\nTraining agent for 500 episodes...")
    q_table = q_learning(env, episodes=500)

    print("\nLearned Q-table (showing Q-values per action):")
    print("State    up    right   down   left  -> Best")
    print("-" * 55)
    for r in range(env.rows):
        for c in range(env.cols):
            q_values = q_table[r][c]
            best_action = q_values.index(max(q_values))
            print(f"({r},{c})  {q_values[0]:6.2f} {q_values[1]:6.2f} "
                  f"{q_values[2]:6.2f} {q_values[3]:6.2f}  -> {env.action_names[best_action]}")

    print("\n" + "=" * 50)
    print("Extracted Policy (Best action per state):")
    policy = extract_policy(q_table)
    for state, action in sorted(policy.items()):
        print(f"  {state}: {action}")

    print("\n" + "=" * 50)
    run_episode_with_policy(env, policy)
