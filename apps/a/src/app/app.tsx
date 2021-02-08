import React from 'react';
import styled from 'styled-components';
import { sharedNameFrom_C } from '@monorepo-example/c'

const StyledApp = styled.div`
  font-family: sans-serif;
  min-width: 300px;
  max-width: 600px;
  margin: 50px auto;

  .flex {
    display: flex;
    align-items: center;
    justify-content: center;
  }
`;

export function App() {
  return (
    <StyledApp>
      <header className="flex">
        <h1>Welcome to {sharedNameFrom_C}!</h1>
      </header>
    </StyledApp>
  )
}

export default App;
