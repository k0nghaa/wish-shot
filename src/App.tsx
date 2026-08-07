import './App.css';
import TestPage from './views/TestPage';

function App() {
  return <>{import.meta.env.DEV && <TestPage />}</>;
}

export default App;
