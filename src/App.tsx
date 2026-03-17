import './App.css';
import TestPage from './pages/TestPage';

function App() {
  return <>{import.meta.env.DEV && <TestPage />}</>;
}

export default App;
